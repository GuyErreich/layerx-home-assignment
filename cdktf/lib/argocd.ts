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
  // Deploy ArgoCD using Helm - with minimal configuration to avoid timeouts
  const argocdRelease = new Release(scope, "argocd", {
    provider: helmProvider,
    name: "argocd",
    namespace: "argocd", // Use the dedicated namespace
    createNamespace: true, // Let Helm create the namespace
    repository: "https://argoproj.github.io/argo-helm",
    chart: "argo-cd",
    version: "7.0.0", // Using a much older, more stable version to avoid compatibility issues
    
    // Configure timeouts and retry behavior - removing atomic to prevent full rollback on timeout
    timeout: 1200, // 20 minutes - increased timeout
    atomic: false, // Don't roll back on failure - this helps avoid the CRD cleanup issues
    cleanupOnFail: false, // Don't try to clean up on failure
    wait: true,
    recreatePods: false, // Avoid recreating pods which can cause delays
    
    // Values to customize ArgoCD installation with minimal resource usage
    values: [
      JSON.stringify({
        // Use the most minimal configuration possible
        global: {
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 999
          }
        },
        
        // Super minimal server config
        server: {
          replicas: 1,
          extraArgs: ["--insecure"],
          service: {
            type: "LoadBalancer",
            annotations: {
              // Explicitly specify internet-facing load balancer
              "service.beta.kubernetes.io/aws-load-balancer-scheme": "internet-facing"
            }
          },
          autoscaling: {
            enabled: false
          },
          resources: {
            limits: {
              cpu: "100m",
              memory: "128Mi"
            },
            requests: {
              cpu: "50m",
              memory: "64Mi"
            }
          }
        },
        
        // Disable or reduce components to absolute minimum
        controller: {
          replicas: 1,
          resources: {
            limits: {
              cpu: "100m",
              memory: "128Mi"
            },
            requests: {
              cpu: "50m",
              memory: "64Mi"
            }
          }
        },
        
        repoServer: {
          replicas: 1,
          resources: {
            limits: {
              cpu: "100m",
              memory: "128Mi"
            },
            requests: {
              cpu: "50m",
              memory: "64Mi"
            }
          }
        },
        
        // Disable optional components
        applicationSet: {
          enabled: false
        },
        notifications: {
          enabled: false
        },
        dex: {
          enabled: false
        },
        
        // Basic auth settings
        configs: {
          secret: {
            createSecret: true,
            argocdServerAdminPassword: "$2a$12$QmPft0fN51eBUiDvWcEcQOSU73Eu/OSaIUvsHuop5JgnwB67CIiRi" // Default 'argocd' password
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
