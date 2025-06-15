import { Construct } from "constructs";
import { IamRole } from "../../.gen/providers/aws/iam-role";
import { IamRolePolicy } from "../../.gen/providers/aws/iam-role-policy";
import { EksCluster } from "../../.gen/providers/aws/eks-cluster";
import { createResourceName } from "./utils";

/**
 * AppIamRole construct for creating IAM roles for Kubernetes applications
 * with IRSA (IAM Roles for Service Accounts) configuration
 */
export class AppIamRole extends Construct {
  /**
   * The IAM role
   */
  public readonly role: IamRole;
  
  /**
   * The ARN of the IAM role
   */
  public readonly roleArn: string;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: AppIamRoleProps
  ) {
    super(scope, id);

    const roleName = createResourceName(this.props.clusterName, this.props.namespace, this.props.appName, "role");
    
    // Create the IAM role with trust relationship for the K8s service account
    this.role = new IamRole(this, "role", {
      name: roleName,
      description: `IAM role for ${this.props.appName} in the ${this.props.namespace} namespace`,
      assumeRolePolicy: this.generateTrustPolicy()
    });
    
    this.roleArn = this.role.arn;

    // Add policies based on configuration
    this.attachPolicies();
  }

  /**
   * Generates the trust policy for the IAM role
   * Supports exact namespace matches or patterns
   */
  private generateTrustPolicy(): string {
    const serviceAccount = this.props.serviceAccount || this.props.appName;
    const isPatternMatch = this.props.namespace.includes("*");
    
    const condition = isPatternMatch 
      ? {
          StringLike: {
            [`${this.props.oidcProvider}:sub`]: `system:serviceaccount:${this.props.namespace}:${serviceAccount}`
          }
        } 
      : {
          StringEquals: {
            [`${this.props.oidcProvider}:sub`]: `system:serviceaccount:${this.props.namespace}:${serviceAccount}`
          }
        };
    
    return JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: {
          Federated: this.props.oidcProviderArn
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: condition
      }]
    });
  }

  /**
   * Attaches policies to the IAM role based on the provided configuration
   */
  private attachPolicies(): void {
    // AWS Secrets Manager access
    if (this.props.secretsAccess && this.props.secretsAccess.length > 0) {
      // Convert secret patterns to ARNs if they're not already
      const secretArns = this.props.secretsAccess.map(secret => {
        // If it's already a full ARN, use it as-is
        if (secret.startsWith("arn:aws:")) {
          return secret;
        }
        
        // Otherwise, construct the ARN without automatically appending a wildcard
        // Let users specify wildcards explicitly in their configs
        return `arn:aws:secretsmanager:${this.props.region}:${this.props.accountId}:secret:${secret}`;
      });

      // Create the policy for Secrets Manager access with a unique name
      new IamRolePolicy(this, `${this.props.appName}-secrets-policy`, {
        name: createResourceName(this.props.clusterName, this.props.namespace, this.props.appName, "secrets-access"),
        role: this.role.id,
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Effect: "Allow",
            Action: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret"
            ],
            Resource: secretArns
          }]
        })
      });
    }

    // S3 bucket access
    if (this.props.s3Access && this.props.s3Access.length > 0) {
      const bucketArns = this.props.s3Access.map(bucket => {
        // Extract bucket name if a full ARN is provided
        const bucketName = bucket.startsWith("arn:aws:s3:::") 
          ? bucket.replace("arn:aws:s3:::", "") 
          : bucket;
          
        return [
          `arn:aws:s3:::${bucketName}`,
          `arn:aws:s3:::${bucketName}/*`
        ];
      }).flat();

      // Create the policy for S3 access with a unique name
      new IamRolePolicy(this, `${this.props.appName}-s3-policy`, {
        name: createResourceName(this.props.clusterName, this.props.namespace, this.props.appName, "s3-access"),
        role: this.role.id,
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Effect: "Allow",
            Action: [
              "s3:GetObject",
              "s3:ListBucket"
            ],
            Resource: bucketArns
          }]
        })
      });
    }

    // SQS queue access
    if (this.props.sqsAccess && this.props.sqsAccess.length > 0) {
      const queueArns = this.props.sqsAccess.map(queue => 
        queue.startsWith("arn:aws:sqs:")
          ? queue
          : `arn:aws:sqs:${this.props.region}:${this.props.accountId}:${queue}`
      );

      new IamRolePolicy(this, `${this.props.appName}-sqs-policy`, {
        name: createResourceName(this.props.clusterName, this.props.namespace, this.props.appName, "sqs-access"),
        role: this.role.id,
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Effect: "Allow",
            Action: [
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl"
            ],
            Resource: queueArns
          }]
        })
      });
    }

    // Add custom policies if provided
    if (this.props.customPolicies && this.props.customPolicies.length > 0) {
      this.props.customPolicies.forEach((policy, index) => {
        new IamRolePolicy(this, `${this.props.appName}-custom-policy-${index}`, {
          name: createResourceName(this.props.clusterName, this.props.namespace, this.props.appName, `custom-policy-${index}`),
          role: this.role.id,
          policy: JSON.stringify(policy)
        });
      });
    }
  }
}

/**
 * Properties for the AppIamRole construct
 */
export interface AppIamRoleProps {
  /**
   * Name of the application
   */
  appName: string;
  
  /**
   * Kubernetes namespace or namespace pattern where the application will run
   * Can include wildcards like "monitoring-*" for a pattern match
   */
  namespace: string;
  
  /**
   * The cluster name for role naming
   */
  clusterName: string;
  
  /**
   * ServiceAccount name that the application will use
   * Defaults to appName if not provided
   */
  serviceAccount?: string;
  
  /**
   * AWS account ID
   */
  accountId: string;
  
  /**
   * OIDC provider URL without https:// prefix
   */
  oidcProvider: string;
  
  /**
   * OIDC provider ARN
   */
  oidcProviderArn: string;
  
  /**
   * AWS region
   */
  region: string;
  
  /**
   * List of AWS Secrets Manager secret patterns to allow access to
   * Format can be a full ARN or a name pattern like "home-assignments/*"
   */
  secretsAccess?: string[];
  
  /**
   * List of S3 bucket names or ARNs to allow access to
   */
  s3Access?: string[];
  
  /**
   * List of SQS queue names or ARNs to allow access to
   */
  sqsAccess?: string[];
  
  /**
   * Custom IAM policy documents to attach to the role
   */
  customPolicies?: any[];
}
