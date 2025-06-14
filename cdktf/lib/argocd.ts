import { Construct } from "constructs";
import { Namespace } from "../.gen/providers/kubernetes/namespace";
import { HelmProvider } from "../.gen/providers/helm/provider";
import { Release } from "../.gen/providers/helm/release";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { ITerraformDependable } from "cdktf";
import { ProviderManager } from "./providers";

export interface ArgoCDResources {
  helmProvider: HelmProvider;
  argocdRelease: Release;
}

export interface ArgoCDOptions {
  eksCluster: EksCluster;
  dependsOn?: ITerraformDependable[]; // Dependencies to ensure correct deployment order
  eksAdminRoleArn?: string; // IAM role ARN for the Kubernetes/Helm provider authentication
}

export function deployArgoCD(scope: Construct, options: ArgoCDOptions): ArgoCDResources {
  // Get the shared Kubernetes and Helm providers from ProviderManager
  // This ensures we use the same providers across all modules
  const kubernetesProvider = ProviderManager.getKubernetesProvider();
  const helmProvider = ProviderManager.getHelmProvider();

  // Let the Helm chart create the namespace - more consistent approach
  // Deploy ArgoCD using Helm
  const argocdRelease = new Release(scope, "argocd", {
    provider: helmProvider,
    name: "argocd",
    namespace: "argocd", // Use the dedicated namespace
    createNamespace: true, // Let Helm create the namespace
    repository: "https://argoproj.github.io/argo-helm",
    chart: "argo-cd",
    //TODO: Might have to update this version based on latest stable release
    version: "7.0.0", // Specify a stable version

    // Values to customize ArgoCD installation
    values: [
      JSON.stringify({
        // Enable High Availability for ArgoCD
        ha: {
          enabled: false // Set to true for production deployments
        },

        server: {
          extraArgs: [
            //TODO: Remove insecure flag in production
            // Allow access without login for demo purposes (remove in production)
            "--insecure"
          ],
          service: {
            type: "LoadBalancer" // Expose ArgoCD via LoadBalancer for easy access
          }
        },

        // Disable TLS for demo purposes (use proper TLS in production)
        configs: {
          secret: {
            createSecret: true,
            //TODO: Remove hardcoded password
            argocdServerAdminPassword: "$2a$10$oPTD5g5.VNwv.rwWeYx7Su1R0VOB0lAWyWlcNuFq1i/eCmdZTXuP2" // Default 'argocd' password
          }
        }
      })
    ],
    
    // Add dependencies to ensure proper ordering
    dependsOn: options.dependsOn || [],
  });

  return {
    helmProvider,
    argocdRelease
  };
}
