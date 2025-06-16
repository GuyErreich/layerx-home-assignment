import { Construct } from "constructs";
import { HelmProvider } from "../.gen/providers/helm/provider";
import { Release } from "../.gen/providers/helm/release";
import { ITerraformDependable } from "cdktf";

export interface ExternalSecretsOperatorResources {
  helmProvider: HelmProvider;
  release: Release;
}

export interface ExternalSecretsOperatorOptions {
  dependsOn?: ITerraformDependable[];
  helmProvider?: HelmProvider;
  aws?: {
    region: string;
    service: string;
  };
}

/**
 * Deploys External Secrets Operator to sync secrets from external providers
 * @param scope CDKTF construct scope
 * @param options Configuration options
 * @returns External Secrets resources
 */
export function deployExternalSecretsOperator(scope: Construct, options: ExternalSecretsOperatorOptions): ExternalSecretsOperatorResources {
  const helmProvider = options.helmProvider || null;
  
  if (!helmProvider) {
    throw new Error("Helm provider is required for External Secrets Operator deployment");
  }
  
  const release = new Release(scope, "external-secrets", {
    provider: helmProvider,
    name: "external-secrets",
    namespace: "kube-system",
    createNamespace: false,
    repository: "https://charts.external-secrets.io",
    chart: "external-secrets",
    version: "0.9.9",
    
    timeout: 900,
    atomic: true,
    cleanupOnFail: true,
    wait: true,
    
    values: [
      JSON.stringify({
        installCRDs: true,
        
        serviceAccount: {
          create: true,
          name: "external-secrets"
        },
        
        resources: {
          requests: {
            cpu: "50m",
            memory: "64Mi"
          },
          limits: {
            cpu: "100m",
            memory: "128Mi"
          }
        },
        
        // AWS provider configuration
        ...(options.aws && {
          aws: {
            region: options.aws.region,
            service: options.aws.service
          }
        }),
        
        webhook: {
          resources: {
            requests: {
              cpu: "50m",
              memory: "64Mi"
            },
            limits: {
              cpu: "100m",
              memory: "128Mi"
            }
          }
        },
        
        certController: {
          resources: {
            requests: {
              cpu: "50m",
              memory: "64Mi"
            },
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
              name: "eso-cleanup"
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
            command: [
              "/bin/bash",
              "-c",
              `
              # Clean up External Secrets Operator finalizers
              for resource in secretstores clustersecretstores externalsecrets; do
                kubectl get $resource -A -o json 2>/dev/null | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                  kubectl patch $resource $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
                done
              done
              `
            ]
          }
        }
      })
    ],
    
    dependsOn: options.dependsOn || []
  });

  return {
    helmProvider,
    release
  };
}
