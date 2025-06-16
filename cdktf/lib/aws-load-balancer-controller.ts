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
              echo "Starting AWS Load Balancer Controller cleanup process..."
              
              # Clean up AWS Load Balancer Controller finalizers from TargetGroupBindings
              echo "Removing finalizers from TargetGroupBindings..."
              kubectl get targetgroupbindings -A -o json | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                echo "Processing TargetGroupBinding $name in namespace $ns"
                kubectl patch targetgroupbindings $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
              done
              
              # Clean up all LoadBalancer service finalizers
              echo "Removing finalizers from LoadBalancer services..."
              kubectl get svc -A -o json | jq -r '.items[] | select(.spec.type=="LoadBalancer") | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                echo "Processing LoadBalancer service $name in namespace $ns"
                kubectl patch service $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
                
                # Force delete any stuck services
                if kubectl get svc $name -n $ns -o json | grep -q '"phase":"Terminating"'; then
                  echo "Force deleting stuck service $name in namespace $ns"
                  kubectl delete service $name -n $ns --grace-period=0 --force || true
                fi
              done
              
              # Clean up Ingress resources
              echo "Removing finalizers from Ingress resources..."
              kubectl get ingress -A -o json 2>/dev/null | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                echo "Processing Ingress $name in namespace $ns"
                kubectl patch ingress $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
              done
              
              # Clean up IngressClassParams
              echo "Removing finalizers from IngressClassParams..."
              kubectl get ingressclassparams -A -o json 2>/dev/null | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                echo "Processing IngressClassParams $name in namespace $ns"
                kubectl patch ingressclassparams $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
              done
              
              # Clean up any other controller related resources
              for resource in ingressclass; do
                echo "Checking $resource resources..."
                kubectl get $resource -A -o json 2>/dev/null | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                  if [[ "$name" == "alb" ]]; then
                    echo "Removing finalizers from $resource $name"
                    kubectl patch $resource $name --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
                  fi
                done
              done
              
              echo "AWS Load Balancer Controller cleanup completed"
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
