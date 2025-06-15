import { Construct } from "constructs";
import { Release } from "../../.gen/providers/helm/release";
import { TerraformResource } from "cdktf";

export interface ExternalSecretsOperatorProps {
  /**
   * Chart version for the External Secrets Operator
   */
  chartVersion?: string;
  
  /**
   * The namespace to deploy External Secrets Operator in
   */
  namespace?: string;
  
  /**
   * Resources this deployment depends on
   */
  dependsOn?: TerraformResource[];
  
  /**
   * AWS provider configuration
   */
  aws?: {
    /**
     * Default AWS region for secrets
     */
    region?: string;
    
    /**
     * Default AWS service to use (SecretsManager, ParameterStore, etc.)
     */
    service?: "SecretsManager" | "ParameterStore";
  };

  /**
   * Explicit Helm provider to use for the release
   * If not provided, the default provider will be used
   */
  helmProvider?: any;
}

export interface ExternalSecretsOperatorResources {
  release: Release;
}

export function deployExternalSecretsOperator(
  scope: Construct,
  props: ExternalSecretsOperatorProps = {}
): ExternalSecretsOperatorResources {
  // Default values
  const chartVersion = props.chartVersion || "v0.17.1-rc1"; // Check for the latest version at https://github.com/external-secrets/external-secrets/releases
  const namespace = props.namespace || "external-secrets";
  const awsRegion = props.aws?.region || "eu-central-1";
  const awsService = props.aws?.service || "SecretsManager";
  
  // Deploy External Secrets Operator using Helm
  const externalSecretsOperatorRelease = new Release(scope, "external-secrets-operator", {
    name: "external-secrets",
    repository: "https://charts.external-secrets.io",
    chart: "external-secrets",
    version: chartVersion,
    namespace: namespace,
    createNamespace: true,
    atomic: true,
    timeout: 300, // 5 minutes timeout for installation
    // Use the explicitly provided Helm provider if available
    ...(props.helmProvider ? { provider: props.helmProvider } : {}),
    
    // Set default values for the chart
    values: [
      JSON.stringify({
        installCRDs: true, // Install the Custom Resource Definitions automatically
        
        // Webhook configurations
        webhook: {
          port: 9443,
        },

        // Cert controller configuration
        certController: {
          enabled: true,
        },
        
        // Service account configuration
        serviceAccount: {
          create: true,
          name: "external-secrets",
        },

        // Default provider configurations
        provider: {
          aws: {
            // Enable the AWS provider
            enabled: true,
            // Default region can be overridden by SecretStore/ClusterSecretStore resources
            region: awsRegion, // Use the value from props or default
            // Default service to use (SecretsManager is most common)
            service: awsService, // Use the value from props or default
          },
        },
        
        // Global controller settings
        controller: {
          leaderElect: true,
          replicas: 1,
        },
      })
    ],

    // Add any dependencies
    dependsOn: props.dependsOn
  });
  
  return {
    release: externalSecretsOperatorRelease
  };
}
