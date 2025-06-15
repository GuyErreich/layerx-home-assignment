/**
 * Configuration for an application IAM role
 */
export interface AppIamConfig {
  /**
   * Name of the application
   */
  appName: string;
  
  /**
   * Kubernetes namespace where the application will run
   * Can include wildcards like "monitoring-*" for a pattern match
   */
  namespace: string;
  
  /**
   * ServiceAccount name that the application will use
   * Defaults to appName if not provided
   */
  serviceAccount?: string;
  
  /**
   * List of AWS Secrets Manager secret patterns to allow access to
   * Format can be a full ARN or a secret name/path
   * IMPORTANT: Include wildcards (*) explicitly if you need pattern matching
   * Examples: 
   *   - "my-secret" (exact match only)
   *   - "path/to/secret*" (pattern match)
   *   - "arn:aws:secretsmanager:region:account:secret:my-secret" (full ARN)
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
  
  /**
   * Optional tags to apply to the IAM role
   */
  tags?: Record<string, string>;
}

/**
 * Interface to hold all created application IAM roles
 * This allows main.ts to reference roles by name
 */
export interface AppIamRolesOutput {
  /**
   * Map of application name to IAM role ARN
   */
  roleArns: Record<string, string>;
}
