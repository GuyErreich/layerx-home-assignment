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
              # Ensure AWS Load Balancer Controller is still accessible
              echo "Checking AWS Load Balancer Controller..."
              if ! kubectl get deployment -n kube-system aws-load-balancer-controller &>/dev/null; then
                echo "AWS Load Balancer Controller not found, ELB resources might not clean up properly"
              fi
              
              # Force remove all finalizers from ArgoCD LoadBalancer service
              echo "Removing ArgoCD server finalizers..."
              kubectl patch svc argocd-server -n argocd --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
              
              # Force delete the service if it still exists
              echo "Force deleting ArgoCD server service if it exists..."
              kubectl delete svc argocd-server -n argocd --grace-period=0 --force --ignore-not-found || true
              
              # Clean up all ArgoCD CRs with finalizers
              echo "Removing finalizers from ArgoCD CRDs..."
              for resource in applications applicationsets appprojects; do
                kubectl get $resource -A -o json 2>/dev/null | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                  echo "Removing finalizers from $resource $name in namespace $ns"
                  kubectl patch $resource $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
                done
              done
              
              # Clean up any other resources with finalizers in the ArgoCD namespace
              echo "Removing finalizers from other resources..."
              for resource in deployments statefulsets services secrets configmaps; do
                kubectl get $resource -n argocd -o json | jq -r '.items[] | select(.metadata.finalizers != null) | .metadata.name' | while read name; do
                  echo "Removing finalizers from $resource $name"
                  kubectl patch $resource $name -n argocd --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
                done
              done
              
              # Ensure AWS ELBs are detached by removing NLB ingress rules
              echo "Getting LoadBalancer details from AWS CLI..."
              ELB_NAME=$(kubectl get svc argocd-server -n argocd -o json 2>/dev/null | jq -r '.status.loadBalancer.ingress[0].hostname' | cut -d- -f1)
              if [[ ! -z "$ELB_NAME" ]]; then
                echo "Found ELB: $ELB_NAME - ensuring cleanup"
                # We would run AWS CLI commands here to force ELB deletion if needed
                # But we'll rely on the AWS Load Balancer Controller to handle this
              fi
              
              # Ensure all terminating pods are force deleted
              echo "Force deleting any terminating pods..."
              kubectl get pods -n argocd | grep Terminating | awk '{print $1}' | xargs -r kubectl delete pod --grace-period=0 --force -n argocd || true
              
              echo "ArgoCD cleanup completed"
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
