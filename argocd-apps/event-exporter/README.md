# Event Exporter

This chart wraps the Bitnami Kubernetes Event Exporter chart and provides custom configuration with AWS Secrets Manager integration.

## How It Works

This setup follows the "chart as dependency" pattern where:

1. We define our own `Chart.yaml` that declares the base chart as a dependency
2. We customize the chart with our own `values.yaml` file
3. ArgoCD monitors this folder in Git and applies changes automatically
4. The Slack webhook URL is fetched from AWS Secrets Manager using the External Secrets Operator

## AWS Secrets Manager Integration

This application securely accesses secrets from AWS Secrets Manager through:

1. **ServiceAccount with IAM Role** - The ServiceAccount used by the event-exporter pod has an annotation linking it to an IAM Role with permissions to access specific secrets.

2. **External Secrets Operator** - The External Secrets Operator is deployed globally in the cluster via CDKTF with a default AWS provider configuration and explicit Helm provider specification. This ensures consistent authentication and simplifies the SecretStore configuration in each application.

3. **SecretStore Resource** - A namespace-scoped SecretStore that inherits the global AWS provider settings but uses this application's ServiceAccount for authentication, providing proper isolation and security boundaries.

4. **ExternalSecret Resource** - Defines which secret to fetch from AWS Secrets Manager and creates a Kubernetes Secret that the event-exporter can use.

## Prerequisites

1. **External Secrets Operator** must be installed in the cluster (this is handled by CDKTF)
   
2. **IAM Role for Service Account** must exist with proper permissions to access AWS Secrets Manager and trust policy for the EKS OIDC provider

   Example IAM policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "secretsmanager:GetResourcePolicy",
           "secretsmanager:GetSecretValue",
           "secretsmanager:DescribeSecret"
         ],
         "Resource": "arn:aws:secretsmanager:eu-central-1:123456789012:secret:layerx/slack-webhook*"
       }
     ]
   }
   ```

3. **AWS Secret** should exist with the Slack webhook URL:
   ```bash
   aws secretsmanager create-secret \
     --name layerx/slack-webhook \
     --secret-string '{"url":"https://hooks.slack.com/services/YOUR_WEBHOOK_PATH"}'
   ```

## Updating Values

To update the configuration:

1. Edit the `values.yaml` file in this directory
2. Commit and push the changes to your Git repository
3. ArgoCD will detect the changes and apply them automatically

The key sections to update in `values.yaml` are:
- `serviceAccount.roleArn`: The ARN of the IAM role with Secrets Manager access
- `externalSecrets.region`: AWS region where your secret is stored
- `externalSecrets.secretName`: Name of your secret in AWS Secrets Manager

## How to Deploy

The associated ArgoCD Application manifest (`application.yaml`) points to this directory and will apply:
- The Chart.yaml dependency definition
- The values.yaml customizations
- Templates for ServiceAccount and External Secrets resources

## Troubleshooting

If the Slack webhook URL is not being retrieved correctly:

1. Check the External Secret status:
   ```bash
   kubectl get externalsecret -n monitoring slack-webhook
   kubectl describe externalsecret -n monitoring slack-webhook
   ```

2. Verify the ServiceAccount has the correct IAM role annotation:
   ```bash
   kubectl get serviceaccount -n monitoring event-exporter -o yaml
   ```

3. Ensure the IAM role has the correct permissions and trust policy
