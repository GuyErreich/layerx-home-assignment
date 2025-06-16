import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, S3Backend, TerraformResource, Fn } from "cdktf";
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

    // S3 Backend for state file
    // Uncomment and configure this for production use
    // new S3Backend(this, {
    //   bucket: "terraform-state-backend-shared", // <-- Change to your S3 bucket name
    //   key: Fn.join("/", [Config.cluster.name, "terraform.tfstate"]),
    //   region: "us-east-1", // or use your preferred region
    //   encrypt: true,
    //   profile: "default" // or your named AWS profile
    // });

    // AWS Provider - get from ProviderManager
    const awsProvider = ProviderManager.getAwsProvider(this);
    
    const region = new DataAwsRegion(this, "current-region");

    // VPC & Subnets
    const vpcModule = new VpcModule(this, "vpc", {
      name: Config.cluster.name,
      cidr: Config.vpc.cidrBlock,
      azs: Config.vpc.numSubnets,
      publicSubnets: true,
      eksClusterName: Config.cluster.name, // Used for proper tagging
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
    
    // Create the OIDC provider in AWS IAM first
    let eksOidcProvider;
    if (iam.createOidcProvider) {
      eksOidcProvider = iam.createOidcProvider(eks.cluster);
      
      // Only update the trust policies after the OIDC provider is created
      // This ensures the role can find the OIDC provider
      
      // Update the EBS CSI Driver role trust policy with the proper OIDC provider
      if (iam.updateEbsCsiDriverRoleTrustPolicy && iam.ebsCsiDriverRole) {
        iam.updateEbsCsiDriverRoleTrustPolicy(eks.cluster);
      }

      // Update the Load Balancer Controller role trust policy with the proper OIDC provider
      if (iam.updateLbControllerRoleTrustPolicy && iam.lbControllerRole) {
        iam.updateLbControllerRoleTrustPolicy(eks.cluster);
      }
    }
    
    // Install native EKS add-ons (EBS CSI Driver) first
    // Core add-ons like VPC CNI, CoreDNS and kube-proxy are managed by bootstrapSelfManagedAddons
    // This ensures the cluster is fully functional before we try to use K8s providers
    const eksAddons: EksAddonsResources = createEksAddons(this, {
      clusterName: eks.cluster.name,
      ebsCsiDriverRoleArn: iam.ebsCsiDriverRole?.arn
    });
    
    // Add a custom resource for a delay to ensure the EKS cluster is fully ready for authentication
    // This helps solve the "server has asked for the client to provide credentials" error
    // We'll use local-exec with sleep command since CDKTF doesn't have built-in time_sleep
    // const eksReadyDelay = new TerraformResource(this, "eks-auth-ready-delay", {
    //   terraformResourceType: "null_resource",
    //   //friendlyUniqueId: "eks-auth-ready-delay",
      
    //   // Add explicit dependencies to ensure this runs after all EKS resources are created
    //   dependsOn: [
    //     eks.cluster, 
    //     eks.nodeGroup, 
    //     ...(eksAddons.ebsCsiDriver ? [eksAddons.ebsCsiDriver] : []), 
    //     ...(eksAddons.vpcCni ? [eksAddons.vpcCni] : [])
    //   ],
      
    //   // Use provisioner for local execution
    //   provisioners: [{
    //     type: "local-exec",
    //     command: `echo "Waiting for 120 seconds for EKS authentication to be ready..." && sleep 120`
    //   }]
    // });
    
    // Initialize Kubernetes and Helm providers now that the EKS cluster and add-ons are ready
    // This makes them available for all subsequent modules
    // This is the critical point where we establish connectivity to the kubernetes API
    // The delay ensures the EKS auth system is ready when we try to access it
    ProviderManager.initializeK8sProviders(this, eks.cluster);
    
    // Deploy AWS Load Balancer Controller using Helm
    // Use the shared Kubernetes and Helm providers from the admin role module
    // This ensures consistent authentication across all components
    // Make this explicitly depend on the delay to ensure auth is ready
    const awsLbController: AwsLoadBalancerControllerResources = deployAwsLoadBalancerController(this, {
      eksCluster: eks.cluster,
      serviceAccountRoleArn: iam.lbControllerRole?.arn,
      vpcId: vpc.vpc.id,
      region: region.name,
      dependsOn: [eks.cluster, eks.nodeGroup]  // Add explicit dependency on the delay
    });

    // Deploy External Secrets Operator using Helm
    // Using the shared providers for consistency
    const externalSecrets: ExternalSecretsOperatorResources = deployExternalSecretsOperator(this, {
      dependsOn: [awsLbController.awsLoadBalancerControllerRelease],
      aws: {
        region: region.name, // Use the current AWS region
        service: "SecretsManager" // Default to SecretsManager
      },
      // Explicitly pass the Helm provider to ensure consistent authentication
      helmProvider: ProviderManager.getHelmProvider()
    });

    // Create IAM roles for applications that need AWS service access
    // These roles follow the IRSA (IAM Roles for Service Accounts) pattern
    // All roles are defined in cdktf/lib/app-iam/config.ts
    
    // Create all application IAM roles from configuration
    const appRoles: AppIamRolesOutput = createAppIamRoles(this, eks.cluster);

    // Create EBS storage class for persistent volumes
    const storageClass = createEbsStorageClass(this);

    // Deploy ArgoCD using Helm (after AWS Load Balancer Controller and External Secrets Operator)
    // Also using the shared providers for consistency
    const argocd: ArgoCDResources = deployArgoCD(this, {
      eksCluster: eks.cluster,
      dependsOn: [
        awsLbController.awsLoadBalancerControllerRelease, 
        externalSecrets.release
      ],
      storageClass: storageClass // Pass the storage class to ArgoCD for PVC creation
    }); // Ensure ArgoCD is deployed after all prerequisites
    
    // Note: We've disabled EKS Auto Mode features (computeConfig, storageConfig, elasticLoadBalancing)
    // and we're using native EKS add-ons instead:
    // 1. AWS EBS CSI Driver for persistent storage
    // 2. VPC CNI for networking
    
    // Infrastructure components:
    // 1. EKS Cluster: Kubernetes control plane
    // 2. Node Group: Worker nodes
    // 3. EBS CSI Driver: Enables persistent storage via native EKS addon
    // 4. VPC CNI: Manages pod networking via native EKS addon
    // 5. AWS Load Balancer Controller: Manages external-to-internal traffic (north-south)
    // 6. ArgoCD: GitOps deployment platform
    
    // Deployment Order:
    // 1. EKS Cluster + IAM Roles
    // 2. Native EKS Add-ons (EBS CSI Driver, VPC CNI)
    // 3. AWS Load Balancer Controller (as Helm chart)
    // 4. ArgoCD (as Helm chart, depends on AWS Load Balancer Controller)
    
    // Infrastructure components:
    // 1. EKS Cluster: Kubernetes control plane
    // 2. Node Group: Worker nodes
    // 3. EBS CSI Driver: Enables persistent storage via native EKS addon
    // 4. VPC CNI: Manages pod networking via native EKS addon
    // 5. AWS Load Balancer Controller: Manages external-to-internal traffic (north-south)
    // 6. External Secrets Operator: Manages secrets from external providers like AWS Secrets Manager
    // 7. ArgoCD: GitOps deployment platform
    // 
    // Future components that could be managed by ArgoCD:
    // 1. Karpenter: Will handle auto-scaling
    // 
    // Internal service-to-service traffic (east-west): Handled by Kubernetes built-in mechanisms
    // - Services of type ClusterIP (default) provide internal DNS names and virtual IPs
    // - CoreDNS enables service discovery by name (service.namespace.svc.cluster.local)
    // - For more advanced internal routing (path/header-based, etc.), consider adding 
    //   an internal NGINX Ingress Controller in the future if needed

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
// Static configuration is fine with string interpolation for stack names
// CDKTF doesn't support Fn functions in the stack ID
new LayerxEksStack(app, `${Config.cluster.name}-stack`);
app.synth();
