# Application IAM Role Management

This module provides a standardized way to create IAM roles for Kubernetes applications
that need access to AWS services, following the IRSA (IAM Roles for Service Accounts) pattern.

## How to Use This Module

### For Infrastructure/Platform Teams

When adding new applications that require AWS access:

1. Add a new entry to the `appIamConfigs` array in `cdktf/lib/app-iam/config.ts`:

```typescript
export const appIamConfigs: AppIamConfig[] = [
  // Existing configs
  
  // Your new application
  {
    appName: "your-app-name",
    namespace: "target-namespace",   // Can use patterns like "my-app-*" 
    serviceAccount: "sa-name",       // Optional: defaults to appName if not provided
    secretsAccess: [
      "path/to/exact-secret",        // For exact secret match
      "path/to/pattern-*"            // Include wildcards explicitly for pattern matching
    ],  
    s3Access: ["my-bucket-name"],    // Module will add /* automatically for object access
    sqsAccess: ["my-queue-name"],    // Exact queue name
    customPolicies: [],              // Optional: custom IAM policy documents
    tags: {                          // Optional: tags for the IAM role
      Application: "your-app-name",
      Purpose: "Description of purpose"
    }
  }
];
```

All roles defined in the config will be automatically created when you run `cdktf deploy`.
The role ARNs will be available as Terraform outputs.

### For Application Teams

When your application needs AWS access:

1. **Submit a PR** to add your application's IAM role configuration to the CDKTF stack
2. Include in your PR:
   - The application name
   - The namespace it will run in
   - The AWS services it needs access to (be specific)
   - Justification for the access
   
3. **Update your application** to use the IAM role:
   - Create a ServiceAccount with the IRSA annotation
   - Configure your pods to use this ServiceAccount

#### Example for Secrets Manager Access

```yaml
# In your Helm values or Kubernetes manifests
serviceAccount:
  name: my-app  # Must match the serviceAccount or appName in the config
  annotations:
    eks.amazonaws.com/role-arn: "${ROLE_ARN}" # Get this from the CDKTF outputs
```

## IAM Role Naming Convention

The roles follow this naming pattern:

```
${cluster-name}-${namespace}-${app-name}-role
```

For example: `layerx-eks-monitoring-event-exporter-role`

## Namespace Pattern Support

This module supports both exact namespace matches and patterns:

```typescript
// Exact namespace match
namespace: "monitoring"

// Pattern match for any namespace starting with "data-processing-"
namespace: "data-processing-*"
```

The IAM trust policy will be configured appropriately with either `StringEquals` or `StringLike` conditions.

## Security Considerations

- Each application gets its own role with least-privilege permissions
- Roles are scoped to specific namespaces and service accounts
- Access is limited to the specific AWS resources needed
- Namespace patterns allow role reuse across multiple environments (dev, staging, etc.)
- Centralized configuration ensures consistent permissions enforcement

## Supported AWS Services

The module currently supports:
- AWS Secrets Manager access
- Amazon S3 bucket access
- Amazon SQS queue access
- Custom IAM policies for special cases

To add support for other AWS services, extend the `attachPolicies` method in the `AppIamRole` construct.
