import { Construct } from "constructs";
import { HelmProvider } from "../.gen/providers/helm/provider";
import { Release } from "../.gen/providers/helm/release";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { ITerraformDependable } from "cdktf";
import { ProviderManager } from "./providers";

export interface AwsLoadBalancerControllerResources {
  helmProvider: HelmProvider;
  awsLoadBalancerControllerRelease: Release;
}

export interface AwsLoadBalancerControllerOptions {
  eksCluster: EksCluster;
  serviceAccountRoleArn?: string;
  vpcId: string;
  region: string;
  dependsOn?: ITerraformDependable[];
}

/**
 * Deploys the AWS Load Balancer Controller to manage ALB/NLB resources
 * @param scope CDKTF construct scope
 * @param options Configuration options
 * @returns Controller resources
 */
export function deployAwsLoadBalancerController(scope: Construct, options: AwsLoadBalancerControllerOptions): AwsLoadBalancerControllerResources {
  const helmProvider = ProviderManager.getHelmProvider();

  const awsLoadBalancerControllerRelease = new Release(scope, "aws-load-balancer-controller", {
    provider: helmProvider,
    name: "aws-load-balancer-controller",
    namespace: "kube-system",
    createNamespace: false,
    repository: "https://aws.github.io/eks-charts",
    chart: "aws-load-balancer-controller",
    version: "1.7.0",
    
    replace: true,
    recreatePods: true,
    skipCrds: false,
    timeout: 900,
    atomic: true,
    cleanupOnFail: true,
    wait: true,
    
    values: [
      JSON.stringify({
        clusterName: options.eksCluster.name,
        region: options.region,
        vpcId: options.vpcId,
        
        installCRDs: true,
        ingressClass: "alb",
        enableIngressClassResource: true,
        enableServiceController: true,
        
        serviceAccount: {
          create: true,
          name: "aws-load-balancer-controller",
          annotations: options.serviceAccountRoleArn ? {
            "eks.amazonaws.com/role-arn": options.serviceAccountRoleArn
          } : {}
        },
        
        enableShield: false,
        enableWaf: false,
        enableWafv2: false,
        
        resources: {
          requests: {
            cpu: "50m",
            memory: "64Mi"
          },
          limits: {
            cpu: "200m",
            memory: "256Mi"
          }
        },
        
        podDisruptionBudget: {
          enabled: true,
          maxUnavailable: 1
        },
        
        hooks: {
          preDelete: {
            enabled: true,
            serviceAccount: {
              create: true,
              name: "lb-controller-cleanup",
              annotations: options.serviceAccountRoleArn ? {
                "eks.amazonaws.com/role-arn": options.serviceAccountRoleArn
              } : {}
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
              # Clean up AWS Load Balancer Controller finalizers
              kubectl get targetgroupbindings -A -o json | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                kubectl patch targetgroupbindings $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
              done
              
              kubectl get svc -A -o json | jq -r '.items[] | select(.spec.type=="LoadBalancer") | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                kubectl patch service $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
              done
              `
            ]
          }
        },
        
        webhookNamespaceSelectors: []
      })
    ],
    dependsOn: options.dependsOn || []
  });

  return {
    helmProvider,
    awsLoadBalancerControllerRelease
  };
}
