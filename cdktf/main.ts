import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, S3Backend } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { VpcModule, VpcModuleOutput } from "./lib/vpc";
import { createIamRoles, EksIamRoles } from "./lib/iam";
import { createEks, EksResources } from "./lib/eks";
import { createEksAddons, EksAddonsResources } from "./lib/eks-addons";
import { Config } from "./lib/config";

class LayerxEksStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // S3 Backend for state file
    // Uncomment and configure this for production use
    // new S3Backend(this, {
    //   bucket: "terraform-state-backend-shared", // <-- Change to your S3 bucket name
    //   key: `${Config.cluster.name}/terraform.tfstate`,
    //   region: "us-east-1", // or use your preferred region
    //   encrypt: true,
    //   profile: "default" // or your named AWS profile
    // });

    // AWS Provider
    new AwsProvider(this, "aws", {});

    // VPC & Subnets
    const vpcModule = new VpcModule(this, "vpc", {
      name: Config.cluster.name,
      cidr: Config.vpc.cidrBlock,
      azs: Config.vpc.numSubnets,
      publicSubnets: true,
      eksClusterName: Config.cluster.name // Used for proper tagging
    });
    
    const vpc: VpcModuleOutput = vpcModule.getOutputs();

    // IAM Roles
    const iam: EksIamRoles = createIamRoles(this);

    // EKS Cluster & Node Group
    const eks: EksResources = createEks(this, {
      eksRoleArn: iam.eksRole.arn,
      nodeRoleArn: iam.nodeRole.arn,
      subnetIds: vpc.publicSubnets.map(subnet => subnet.id),
      dependsOn: [vpc.vpc, ...vpc.publicSubnets] // Explicit dependency on VPC resources
    });
    
    // Update the EBS CSI Driver role trust policy with the proper OIDC provider
    if (iam.updateEbsCsiDriverRoleTrustPolicy && iam.ebsCsiDriverRole) {
      iam.updateEbsCsiDriverRoleTrustPolicy(eks.cluster);
    }

    // Install native EKS add-ons (EBS CSI Driver, VPC CNI)
    const eksAddons: EksAddonsResources = createEksAddons(this, {
      clusterName: eks.cluster.name,
      ebsCsiDriverRoleArn: iam.ebsCsiDriverRole?.arn
    });
    
    // Note: We've disabled EKS Auto Mode features (computeConfig, storageConfig, elasticLoadBalancing)
    // and we're using native EKS add-ons instead:
    // 1. AWS EBS CSI Driver for persistent storage
    // 2. VPC CNI for networking
    // 3. (Future) AWS Load Balancer Controller for ingress (via ArgoCD)
    // 4. (Future) Karpenter for auto-scaling
    
    // Infrastructure components:
    // 1. EBS CSI Driver: Enables persistent storage via native EKS addon
    // 2. VPC CNI: Manages pod networking via native EKS addon
    
    // ArgoCD-managed components (post-deployment):
    // 1. AWS Load Balancer Controller: Will manage external-to-internal traffic (north-south)
    // 2. Karpenter: Will handle auto-scaling
    // 
    // 2. Internal service-to-service traffic (east-west): Handled by Kubernetes built-in mechanisms
    //    - Services of type ClusterIP (default) provide internal DNS names and virtual IPs
    //    - CoreDNS enables service discovery by name (service.namespace.svc.cluster.local)
    //    - For more advanced internal routing (path/header-based, etc.), consider adding 
    //      an internal NGINX Ingress Controller in the future if needed

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
      value: `aws eks update-kubeconfig --name ${eks.cluster.name} --region $(aws configure get region)`,
      description: "Command to configure kubectl for the cluster"
    });
  }
}

const app = new App();
new LayerxEksStack(app, `${Config.cluster.name}-stack`);
app.synth();
