import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, Fn } from "cdktf";
import { VpcModule, VpcModuleOutput } from "./lib/vpc";
import { createIamRoles, EksIamRoles } from "./lib/iam";
import { createEks, EksResources } from "./lib/eks";
import { createEksAddons, EksAddonsResources } from "./lib/eks-addons";
import { deployArgoCD, ArgoCDResources } from "./lib/argocd";
import { deployAwsLoadBalancerController, AwsLoadBalancerControllerResources } from "./lib/aws-load-balancer-controller";
import { deployExternalSecretsOperator, ExternalSecretsOperatorResources } from "./lib/external-secrets";
import { createAppIamRoles, AppIamRolesOutput  } from "./lib/app-iam";
import { createEbsStorageClass } from "./lib/storage";
import { Config } from "./lib/config";
import { DataAwsRegion } from "./.gen/providers/aws/data-aws-region";
import { ProviderManager } from "./lib/providers";

class LayerxEksStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // AWS Provider - get from ProviderManager
    const awsProvider = ProviderManager.getAwsProvider(this);
    
    const region = new DataAwsRegion(this, "current-region");

    // VPC & Subnets
    const vpcModule = new VpcModule(this, "vpc", {
      name: Config.cluster.name,
      cidr: Config.vpc.cidrBlock,
      azs: Config.vpc.numSubnets,
      publicSubnets: true,
      eksClusterName: Config.cluster.name,
    });
    
    const vpc: VpcModuleOutput = vpcModule.getOutputs();

    // IAM Roles
    const iam: EksIamRoles = createIamRoles(this);

    // EKS Cluster & Node Group
    const eks: EksResources = createEks(this, {
      eksRoleArn: iam.eksRole.arn,
      nodeRoleArn: iam.nodeRole.arn,
      subnetIds: vpc.publicSubnets.map(subnet => subnet.id),
      dependsOn: [vpc.vpc, ...vpc.publicSubnets]
    });
    
    // Create the OIDC provider in AWS IAM first
    let eksOidcProvider;
    if (iam.createOidcProvider) {
      eksOidcProvider = iam.createOidcProvider(eks.cluster);
      
      if (iam.updateEbsCsiDriverRoleTrustPolicy && iam.ebsCsiDriverRole) {
        iam.updateEbsCsiDriverRoleTrustPolicy(eks.cluster);
      }

      if (iam.updateLbControllerRoleTrustPolicy && iam.lbControllerRole) {
        iam.updateLbControllerRoleTrustPolicy(eks.cluster);
      }
    }
    
    // Install native EKS add-ons (EBS CSI Driver)
    const eksAddons: EksAddonsResources = createEksAddons(this, {
      clusterName: eks.cluster.name,
      ebsCsiDriverRoleArn: iam.ebsCsiDriverRole?.arn
    });
    
    // Initialize Kubernetes and Helm providers
    ProviderManager.initializeK8sProviders(this, eks.cluster);
    
    // Create EBS storage class for persistent volumes
    const storageClass = createEbsStorageClass(this);
    
    // Deploy AWS Load Balancer Controller using Helm
    const awsLbController: AwsLoadBalancerControllerResources = deployAwsLoadBalancerController(this, {
      eksCluster: eks.cluster,
      serviceAccountRoleArn: iam.lbControllerRole?.arn,
      vpcId: vpc.vpc.id,
      region: region.name,
      dependsOn: [eks.cluster, eks.nodeGroup, ...(eksAddons.ebsCsiDriver ? [eksAddons.ebsCsiDriver] : [])]
    });

    // Deploy External Secrets Operator using Helm
    const externalSecrets: ExternalSecretsOperatorResources = deployExternalSecretsOperator(this, {
      dependsOn: [awsLbController.awsLoadBalancerControllerRelease],
      aws: {
        region: region.name,
        service: "SecretsManager"
      },
      helmProvider: ProviderManager.getHelmProvider()
    });

    // Create IAM roles for applications
    const appRoles: AppIamRolesOutput = createAppIamRoles(this, eks.cluster);

    // Deploy ArgoCD using Helm - will be the last to be created and first to be destroyed
    const argocd: ArgoCDResources = deployArgoCD(this, {
      eksCluster: eks.cluster,
      dependsOn: [
        awsLbController.awsLoadBalancerControllerRelease, 
        externalSecrets.release,
        storageClass
      ],
      storageClass: storageClass
    });

    // Outputs
    new TerraformOutput(this, "cluster_name", { 
      value: eks.cluster.name,
      description: "The name of the EKS cluster"
    });
    
    new TerraformOutput(this, "cluster_endpoint", { 
      value: eks.cluster.endpoint,
      description: "The endpoint for the EKS cluster API server"
    });
    
    new TerraformOutput(this, "cluster_ca_certificate", { 
      value: eks.cluster.certificateAuthority.get(0).data,
      description: "The certificate authority data for the cluster (base64 encoded)",
      sensitive: true
    });
    
    new TerraformOutput(this, "kubeconfig_command", {
      value: Fn.join("", ["aws eks update-kubeconfig --name ", eks.cluster.name, " --region $(aws configure get region)"]),
      description: "Command to configure kubectl for the cluster"
    });
  }
}

const app = new App();
new LayerxEksStack(app, `${Config.cluster.name}-stack`);
app.synth();
