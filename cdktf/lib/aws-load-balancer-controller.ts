import { Construct } from "constructs";
import { HelmProvider } from "../.gen/providers/helm/provider";
import { Release } from "../.gen/providers/helm/release";
import { Config } from "./config";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { Fn, ITerraformDependable, TerraformResource } from "cdktf";
import { ConfigMap } from "../.gen/providers/kubernetes/config-map";
import { ProviderManager } from "./providers";

export interface AwsLoadBalancerControllerResources {
  helmProvider: HelmProvider;
  awsLoadBalancerControllerRelease: Release;
}

export interface AwsLoadBalancerControllerOptions {
  eksCluster: EksCluster;
  serviceAccountRoleArn?: string; // IAM role ARN for the Load Balancer Controller
  vpcId: string; // VPC ID for the Load Balancer Controller
  region: string;
  eksAdminRoleArn?: string; // IAM role ARN for the Kubernetes/Helm provider authentication
  dependsOn?: ITerraformDependable[]; // Optional dependencies for explicit ordering
}

export function deployAwsLoadBalancerController(scope: Construct, options: AwsLoadBalancerControllerOptions): AwsLoadBalancerControllerResources {
  // Get the shared Kubernetes and Helm providers from ProviderManager
  // This ensures we use the same providers across all modules
  const helmProvider = ProviderManager.getHelmProvider();

  // Deploy AWS Load Balancer Controller using Helm
  const awsLoadBalancerControllerRelease = new Release(scope, "aws-load-balancer-controller", {
    provider: helmProvider,
    name: "aws-load-balancer-controller",
    namespace: "kube-system", // Deploy to kube-system namespace
    createNamespace: false,   // kube-system already exists
    repository: "https://aws.github.io/eks-charts",
    chart: "aws-load-balancer-controller",
    // Use specific version that's known to work well
    version: "1.7.0",
    
    // Force replacement of existing chart
    replace: true, // Replace the chart if it already exists
    recreatePods: true, // Recreate pods to ensure clean deployment
    
    // Configure CRD handling
    skipCrds: false, // Do not skip CRD installation
    
    // Configure timeouts to give CRDs time to install
    timeout: 900, // 15 minutes
    
    // Force install even if previous installation exists
    atomic: true,
    cleanupOnFail: true,
    wait: true, // Wait for resources to be ready before marking the release as successful
    
    // Values to customize the AWS Load Balancer Controller installation
    values: [
      JSON.stringify({
        clusterName: options.eksCluster.name,
        // Get the region from config
        region: options.region,
        // VPC ID passed from main.ts
        vpcId: options.vpcId,
        
        // Explicitly enable CRD installation in chart values
        installCRDs: true,
        
        ingressClass: "alb", // Specify the ingress class for Ingress resources
        
        // Enable both ALB and NLB controller modes
        enableIngressClassResource: true, // Create the IngressClass resource
        enableServiceController: true,    // Enable the Service controller for LoadBalancer Services (NLB)
        
        // Use IAM roles for service accounts if provided
        serviceAccount: {
          create: true,
          name: "aws-load-balancer-controller",
          annotations: options.serviceAccountRoleArn ? {
            "eks.amazonaws.com/role-arn": options.serviceAccountRoleArn
          } : {}
        },
        
        // Enable controller features
        enableShield: false, // AWS Shield for DDoS protection (additional cost)
        enableWaf: false,    // AWS WAF for web application firewall (additional cost)
        enableWafv2: false,  // AWS WAFv2 (additional cost)
        
        // Set more conservative resource requests to ensure pods can be scheduled
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
        
        // Additional settings for stability
        podDisruptionBudget: {
          enabled: true,
          maxUnavailable: 1
        },
        
        // Add cleanup hook that will run before deletion to clean up resources with finalizers
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
            weight: -10, // Run before anything else in the deletion process
            annotations: {
              "helm.sh/hook": "pre-delete",
              "helm.sh/hook-delete-policy": "before-hook-creation,hook-succeeded",
              "helm.sh/hook-weight": "-10"
            },
            // Commands to clean up any resources with finalizers
            command: [
              "/bin/bash",
              "-c",
              `
              # Find and remove finalizers from targetgroupbindings and ingresses
              echo "Cleaning up AWS Load Balancer Controller resources and finalizers..."
              
              # Remove finalizers from targetgroupbindings
              kubectl get targetgroupbindings -A -o json | jq -r '.items[] | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                echo "Removing finalizers from targetgroupbinding $ns/$name"
                kubectl patch targetgroupbindings $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
              done
              
              # Remove finalizers from services with loadbalancer type
              kubectl get svc -A -o json | jq -r '.items[] | select(.spec.type=="LoadBalancer") | .metadata.namespace + " " + .metadata.name' | while read ns name; do
                echo "Removing finalizers from service $ns/$name"
                kubectl patch service $name -n $ns --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' --overwrite || true
              done
              
              # Find and delete any leaked AWS Load Balancer resources in the cloud
              echo "Done removing finalizers."
              `
            ]
          }
        },
        
        // Avoid using webhooks to simplify initial deployment
        webhookNamespaceSelectors: []
      })
    ],
    dependsOn: options.dependsOn || [] // Optional dependencies for explicit ordering
  });

  return {
    helmProvider,
    awsLoadBalancerControllerRelease
  };
}
