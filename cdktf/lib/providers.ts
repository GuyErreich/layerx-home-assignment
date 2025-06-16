import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { KubernetesProvider } from "../.gen/providers/kubernetes/provider";
import { HelmProvider } from "../.gen/providers/helm/provider";
import { Fn } from "cdktf";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { DataAwsEksClusterAuth } from "../.gen/providers/aws/data-aws-eks-cluster-auth";
import { Construct } from "constructs";
import { Config } from "./config";

/**
 * Provider Manager - Singleton class to manage all providers in the project
 * Ensures a single instance of each provider and handles provider dependencies
 */
export class ProviderManager {
  // Private static instances
  private static awsProviderInstance: AwsProvider;
  private static kubernetesProviderInstance: KubernetesProvider;
  private static helmProviderInstance: HelmProvider;
  private static clusterAuthInstance: DataAwsEksClusterAuth;
  private static isK8sInitialized = false;
  
  /**
   * Get the AWS provider instance
   * Creates it if it doesn't exist yet
   */
  public static getAwsProvider(scope: Construct): AwsProvider {
    if (!this.awsProviderInstance) {
      this.awsProviderInstance = new AwsProvider(scope, "aws", {
        region: Config.region
      });
    }
    return this.awsProviderInstance;
  }
  
  /**
   * Initialize Kubernetes and Helm providers
   * Must be called after EKS cluster is created
   */
  public static initializeK8sProviders(scope: Construct, eksCluster: EksCluster): void {
    if (this.isK8sInitialized) {
      console.warn("K8s providers already initialized. Skipping.");
      return;
    }
    
    // Use the aws_eks_cluster_auth data source to get an authentication token
    this.clusterAuthInstance = new DataAwsEksClusterAuth(scope, "eks-auth", {
      name: eksCluster.name,
    });
    
    // Create the Kubernetes provider using the token from aws_eks_cluster_auth
    this.kubernetesProviderInstance = new KubernetesProvider(scope, "k8s", {
      host: eksCluster.endpoint,
      clusterCaCertificate: Fn.base64decode(eksCluster.certificateAuthority.get(0).data),
      token: this.clusterAuthInstance.token,
    });
    
    // Create the Helm provider using the same token
    this.helmProviderInstance = new HelmProvider(scope, "helm", {
      kubernetes: {
        host: eksCluster.endpoint,
        clusterCaCertificate: Fn.base64decode(eksCluster.certificateAuthority.get(0).data),
        token: this.clusterAuthInstance.token,
      }
    });
    
    this.isK8sInitialized = true;
  }
  
  /**
   * Get the Kubernetes provider instance
   * @throws Error if called before providers are initialized
   */
  public static getKubernetesProvider(): KubernetesProvider {
    if (!this.isK8sInitialized) {
      throw new Error(
        "Kubernetes provider not initialized. Call initializeK8sProviders() after EKS cluster creation."
      );
    }
    return this.kubernetesProviderInstance;
  }
  
  /**
   * Get the Helm provider instance
   * @throws Error if called before providers are initialized
   */
  public static getHelmProvider(): HelmProvider {
    if (!this.isK8sInitialized) {
      throw new Error(
        "Helm provider not initialized. Call initializeK8sProviders() after EKS cluster creation."
      );
    }
    return this.helmProviderInstance;
  }
  
  /**
   * Check if Kubernetes and Helm providers have been initialized
   */
  public static areK8sProvidersInitialized(): boolean {
    return this.isK8sInitialized;
  }
}
