import { Construct } from "constructs";
import { Namespace } from "../.gen/providers/kubernetes/namespace";
import { HelmProvider } from "../.gen/providers/helm/provider";
import { Release } from "../.gen/providers/helm/release";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { ITerraformDependable } from "cdktf";
import { ProviderManager } from "./providers";
import { PersistentVolumeClaim } from "../.gen/providers/kubernetes/persistent-volume-claim";
import { StorageClass } from "../.gen/providers/kubernetes/storage-class";

export interface ArgoCDResources {
  helmProvider: HelmProvider;
  argocdRelease: Release;
}

export interface ArgoCDOptions {
  eksCluster: EksCluster;
  dependsOn?: ITerraformDependable[]; // Dependencies to ensure correct deployment order
  eksAdminRoleArn?: string; // IAM role ARN for the Kubernetes/Helm provider authentication
  storageClass?: StorageClass; // Optional storage class for PVC
}

export function deployArgoCD(scope: Construct, options: ArgoCDOptions): ArgoCDResources {
  // Get the shared Kubernetes and Helm providers from ProviderManager
  // This ensures we use the same providers across all modules
  const kubernetesProvider = ProviderManager.getKubernetesProvider();
  const helmProvider = ProviderManager.getHelmProvider();
  
  // Use a data source to check if the namespace exists instead of creating it
  // This is safer than trying to create it directly when it might already exist
  // This can be imported using the Terraform CLI if needed
  const argocdNamespace = new Namespace(scope, "argocd-namespace", {
    metadata: {
      name: "argocd",
      labels: {
        "app.kubernetes.io/part-of": "argocd",
      },
    },
  });
  
  // Create a PVC for ArgoCD repo-server directly in this module
  const argoCdRepoPvc = new PersistentVolumeClaim(scope, "argocd-repo-server-pvc", {
    dependsOn: [...(options.storageClass ? [options.storageClass] : []), argocdNamespace],
    metadata: {
      name: "argocd-repo-server-cache",
      namespace: "argocd",
      labels: {
        "app.kubernetes.io/part-of": "argocd",
      },
      // annotations: {
      //   "volume.beta.kubernetes.io/storage-provisioner": "ebs.csi.aws.com",
      // },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: "5Gi",
        },
      },
      storageClassName: options.storageClass?.metadata.name || "gp2", // Use default if no storage class provided
    },
    // Add timeouts to avoid the rate limiter issue
    timeouts: {
      create: "15m", // Increase timeout to 15 minutes for creation
    },
  });

  // Deploy ArgoCD using Helm with the namespace already created by our Namespace resource
  // This ensures proper ordering for PVC creation and namespace availability
  const argocdRelease = new Release(scope, "argocd", {
    provider: helmProvider,
    name: "argocd",
    namespace: "argocd", // Use the dedicated namespace
    createNamespace: false, // Don't let Helm create the namespace - we created it explicitly above
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
          },
          // Add this to force ArgoCD to use our pre-provisioned PVC
          // instead of trying to create its own
          pvcAnnotations: {
            "helm.sh/resource-policy": "keep"
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
              cpu: "200m",
              memory: "1Gi" // Increased memory for better stability
            },
            requests: {
              cpu: "100m",
              memory: "512Mi" // Increased request memory
            }
          }
        },
        
        repoServer: {
          replicas: 1,
          resources: {
            limits: {
              cpu: "300m",
              memory: "1Gi" // Increased memory to handle Helm operations
            },
            requests: {
              cpu: "100m",
              memory: "512Mi" // Increased request memory
            }
          },
          // Add a volume for Helm repo cache persistence
          volumes: [
            {
              name: "helm-repo-cache",
              persistentVolumeClaim: {
                claimName: "argocd-repo-server-cache"
              }
            }
          ],
          volumeMounts: [
            {
              name: "helm-repo-cache",
              mountPath: "/custom-helm-cache" // Use a unique path that won't conflict
            }
          ],
          env: [
            {
              name: "HELM_CACHE_HOME",
              value: "/custom-helm-cache" // Match the volumeMount path
            },
            {
              name: "HELM_CONFIG_HOME",
              value: "/custom-helm-cache"
            },
            {
              name: "HELM_DATA_HOME", 
              value: "/custom-helm-cache"
            }
          ],
          extraArgs: [
            "--repo-cache-expiration=24h" // Keep repos cached for 24 hours
          ]
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
    dependsOn: [...(options.dependsOn || []), argoCdRepoPvc, argocdNamespace],
  });

  return {
    helmProvider,
    argocdRelease
  };
}
