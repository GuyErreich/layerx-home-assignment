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
  dependsOn?: ITerraformDependable[];
  storageClass?: StorageClass;
}

/**
 * Deploys ArgoCD for GitOps-based Kubernetes deployments
 * @param scope CDKTF construct scope
 * @param options Configuration options
 * @returns ArgoCD resources
 */
export function deployArgoCD(scope: Construct, options: ArgoCDOptions): ArgoCDResources {
  const kubernetesProvider = ProviderManager.getKubernetesProvider();
  const helmProvider = ProviderManager.getHelmProvider();
  
  const argocdNamespace = new Namespace(scope, "argocd-namespace", {
    metadata: {
      name: "argocd",
      labels: {
        "app.kubernetes.io/part-of": "argocd",
      },
    },
  });
  
  const argoCdRepoPvc = new PersistentVolumeClaim(scope, "argocd-repo-server-pvc", {
    dependsOn: [...(options.storageClass ? [options.storageClass] : []), argocdNamespace],
    metadata: {
      name: "argocd-repo-server-cache",
      namespace: "argocd",
      labels: {
        "app.kubernetes.io/part-of": "argocd",
      },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: "5Gi",
        },
      },
      storageClassName: options.storageClass?.metadata.name || "gp2",
    },
    timeouts: {
      create: "15m",
    },
  });

  const argocdRelease = new Release(scope, "argocd", {
    provider: helmProvider,
    name: "argocd",
    namespace: "argocd",
    createNamespace: false,
    repository: "https://argoproj.github.io/argo-helm",
    chart: "argo-cd",
    version: "7.0.0",
    
    timeout: 1200,
    atomic: true,
    cleanupOnFail: true,
    wait: true,
    recreatePods: false,
    skipCrds: false,
    replace: false,
    forceUpdate: true,
    
    values: [
      JSON.stringify({
        global: {
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 999
          },
          pvcAnnotations: {
            "helm.sh/resource-policy": "keep"
          }
        },
        
        server: {
          replicas: 1,
          extraArgs: ["--insecure"],
          service: {
            type: "LoadBalancer",
            annotations: {
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
            }
          }
        },
        
        hooks: {
          preDelete: {
            enabled: true,
            serviceAccount: {
              create: true,
              name: "argocd-cleanup"
            },
            image: {
              repository: "bitnami/kubectl",
              tag: "latest"
            },
            weight: -10,
            annotations: {
              "helm.sh/hook": "pre-delete",
              "helm.sh/hook-delete-policy": "before-hook-creation,hook-succeeded",
              "helm.sh/hook-weight": "-10"
            },
            requests: {
              cpu: "50m",
              memory: "64Mi"
            },
            command: [
              "/bin/bash",
              "-c",
              `
              # Clean up ArgoCD finalizers
              kubectl patch svc argocd-server -n argocd --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
              
              sleep 5
              
              if kubectl get svc argocd-server -n argocd >/dev/null 2>&1; then
                kubectl delete svc argocd-server -n argocd --grace-period=0 --force || true
              fi
              
              for resource in applications applicationsets appprojects; do
                kubectl get $resource -n argocd -o json 2>/dev/null | jq -r '.items[] | .metadata.name' | while read name; do
                  kubectl patch $resource $name -n argocd --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
                done
              done
              
              kubectl get secrets -n argocd -o json | jq -r '.items[] | select(.metadata.finalizers != null) | .metadata.name' | while read name; do
                kubectl patch secret $name -n argocd --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
              done
              `
            ]
          }
        },
        
        controller: {
          replicas: 1,
          resources: {
            limits: {
              cpu: "200m",
              memory: "1Gi"
            },
            requests: {
              cpu: "100m",
              memory: "512Mi"
            }
          }
        },
        
        repoServer: {
          replicas: 1,
          resources: {
            limits: {
              cpu: "300m",
              memory: "1Gi"
            },
            requests: {
              cpu: "100m",
              memory: "512Mi"
            }
          },
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
              mountPath: "/custom-helm-cache"
            }
          ],
          env: [
            {
              name: "HELM_CACHE_HOME",
              value: "/custom-helm-cache"
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
            "--repo-cache-expiration=24h"
          ]
        },
        
        applicationSet: {
          enabled: false
        },
        notifications: {
          enabled: false
        },
        dex: {
          enabled: false
        },
        
        configs: {
          secret: {
            createSecret: true,
            argocdServerAdminPassword: "$2a$12$QmPft0fN51eBUiDvWcEcQOSU73Eu/OSaIUvsHuop5JgnwB67CIiRi" // Default 'argocd' password
          }
        }
      })
    ],
    
    dependsOn: [...(options.dependsOn || []), argoCdRepoPvc, argocdNamespace],
  });

  return {
    helmProvider,
    argocdRelease
  };
}
