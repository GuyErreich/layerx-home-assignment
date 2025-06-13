import { Construct } from "constructs";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { EksNodeGroup } from "../.gen/providers/aws/eks-node-group";
import { Namespace } from "../.gen/providers/kubernetes/namespace";
import { KubernetesProvider } from "../.gen/providers/kubernetes/provider";
import { Fn, Token } from "cdktf";
import { Config } from "./config";

export interface EksResources {
  cluster: EksCluster;
  nodeGroup: EksNodeGroup;
  kubernetesProvider: KubernetesProvider;
}

export interface EksOptions {
  eksRoleArn: string;
  nodeRoleArn: string;
  subnetIds: string[];
  dependsOn?: any[]; // Allow specifying explicit dependencies
}

export function createEks(scope: Construct, options: EksOptions): EksResources {
  const cluster = new EksCluster(scope, "eksCluster", {
    name: Config.cluster.name,
    roleArn: options.eksRoleArn,
    version: Config.cluster.version, // Using a stable version that's well-supported
    dependsOn: options.dependsOn, // Add explicit dependencies
    // Modern cluster configuration
    accessConfig: {
      authenticationMode: "API_AND_CONFIG_MAP", // Use both IAM and ConfigMap for flexibility
    },
    bootstrapSelfManagedAddons: false, // We'll use ArgoCD for add-ons
    // Disable built-in compute auto-scaling as we'll use Karpenter later
    computeConfig: {
      enabled: false, // We'll use Karpenter for auto-scaling instead of EKS Auto Mode compute
    },
    // Disable Auto Mode storage management
    storageConfig: {
      blockStorage: {
        enabled: false, // Must be false to be consistent with computeConfig
      },
    },
    // We've disabled encryption config for now
    // To enable it, you'll need to create a KMS key first and provide its ARN
    // encryptionConfig: {
    //   provider: {
    //     keyArn: "arn:aws:kms:REGION:ACCOUNT_ID:key/KEY_ID", // Replace with a real KMS key ARN
    //   },
    //   resources: ["secrets"],
    // },
    // Configure networking
    kubernetesNetworkConfig: {
      serviceIpv4Cidr: "10.100.0.0/16", // Custom range for pod/service IPs
      elasticLoadBalancing: {
        enabled: false, // Must be false to be consistent with computeConfig
        // Note: We'll deploy AWS Load Balancer Controller separately to handle load balancing
      },
    },
    vpcConfig: {
      subnetIds: options.subnetIds,
      endpointPrivateAccess: false, // Disable private endpoint for simplicity
      endpointPublicAccess: true,   // Use only public access for free tier setup
      publicAccessCidrs: ["0.0.0.0/0"], // Can be restricted to specific IPs for production
    },
  });

  // Direct approach to dependencies - in CDKTF this should work
  if (options.dependsOn && options.dependsOn.length > 0) {
    // Instead of trying complex approaches, we use CDKTF's built-in dependency mechanism
    options.dependsOn.forEach(dep => {
      // This correctly adds the resource to the "depends_on" list in Terraform
      cluster.node.addDependency(dep);
    });
  }

  const nodeGroup = new EksNodeGroup(scope, "eksNodeGroup", {
    clusterName: cluster.name,
    nodeRoleArn: options.nodeRoleArn,
    subnetIds: options.subnetIds,
    version: cluster.version, // Ensure version matches the cluster
    instanceTypes: [Config.nodeGroup.instanceType], // Use config-defined instance type
    diskSize: Config.nodeGroup.diskSize, // Specify disk size in GB from config
    amiType: "AL2_x86_64", // Amazon Linux 2
    scalingConfig: {
      desiredSize: Config.nodeGroup.desiredSize,
      maxSize: Config.nodeGroup.maxSize,
      minSize: Config.nodeGroup.minSize,
    },
    // Add remote access configuration if needed for troubleshooting
    // remoteAccess: {
    //   ec2SshKey: "your-key-name", // Replace with your key pair name if you need SSH access
    // },
    // Ensure we wait for cluster to be active first
    dependsOn: [cluster],
    // Add tags for better visibility
    tags: {
      "Name": `${Config.cluster.name}-node`,
      [`kubernetes.io/cluster/${Config.cluster.name}`]: "owned",
    },
  });

  // Create the Kubernetes provider properly with base64 decoding
  // We need to use Fn.base64decode for the certificate
  const kubernetesProvider = new KubernetesProvider(scope, "k8s", {
    host: cluster.endpoint,
    // Use proper method to handle the certificate data
    clusterCaCertificate: `${ Fn.base64decode(cluster.certificateAuthority.get(0).data) }`,
  });

  // Namespaces as part of EKS - Create after the provider is established
  // Create namespaces from Config
  Config.namespaces.forEach((namespace, index) => {
    new Namespace(scope, `${namespace}-ns`, {
      metadata: { name: namespace }
    });
  });

  return { cluster, nodeGroup, kubernetesProvider };
}
