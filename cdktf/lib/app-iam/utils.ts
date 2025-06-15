import { AppIamConfig } from "./types";
import { appIamConfigs } from "./config";
import { Fn } from "cdktf";

/**
 * Get app configs for a specific cluster
 * 
 * Can be used to filter configs based on cluster-specific requirements
 * 
 * @param clusterName The name of the cluster
 * @returns Array of app IAM configurations
 */
export function getAppConfigsForCluster(clusterName: string): AppIamConfig[] {
  // For now, return all configs, but this provides the hook to implement
  // cluster-specific filtering in the future if needed
  
  // Could be extended with logic like:
  // - Return only configs that match a specific tag or label
  // - Return configs based on environment (dev, staging, prod)
  // - Apply different namespace patterns based on cluster
  
  return appIamConfigs;
}

/**
 * Sanitize a string for use in resource names and IDs
 * Always uses Fn functions, assuming input could be a token
 * 
 * @param str The string to sanitize
 * @returns A sanitized string safe for use in resource IDs and names
 */
export function sanitizeString(str: string): string {
  // If empty or null, return a safe default
  if (!str) return "resource";
  
  // Always use Fn.replace - assume everything could be a token
  // Replace wildcards with "wildcard"
  return Fn.replace(str, "*", "wildcard");
  
  // Note: We can't do more complex sanitization safely with Terraform functions
  // since Fn.replace doesn't support regex and multiple replacements can be risky
  // Rely on users providing clean input values in the config
}

/**
 * Sanitize an app ID for use in resource names
 * Always uses Fn functions, assuming all inputs could be tokens
 * 
 * @param namespace The namespace (can contain wildcards)
 * @param appName The application name
 * @returns A sanitized ID string
 */
export function sanitizeAppId(namespace: string, appName: string): string {
  // Sanitize inputs individually
  const sanitizedNamespace = sanitizeString(namespace);
  const sanitizedAppName = sanitizeString(appName);
  
  // Always use Fn.join - assume everything could be a token
  return Fn.join("-", [sanitizedNamespace, sanitizedAppName]);
}

/**
 * Create a unique resource name for IAM roles, policies, etc.
 * Always uses Fn functions, assuming all inputs could be tokens
 * 
 * @param clusterName The cluster name
 * @param namespace The namespace (can contain wildcards)
 * @param appName The application name
 * @param resourceType The resource type (e.g., "role", "secrets-policy")
 * @returns A sanitized resource name
 */
export function createResourceName(
  clusterName: string, 
  namespace: string, 
  appName: string,
  resourceType: string
): string {
  // Sanitize each component individually
  const sanitizedNamespace = sanitizeString(namespace);
  const sanitizedAppName = sanitizeString(appName);
  const sanitizedClusterName = sanitizeString(clusterName);
  const sanitizedResourceType = sanitizeString(resourceType);
  
  // Always use Fn.join - assume everything could be a token
  return Fn.join("-", [
    sanitizedClusterName,
    sanitizedNamespace,
    sanitizedAppName,
    sanitizedResourceType
  ]);
}

/**
 * Create a concrete ID for constructs, which must be a string at synthesis time
 * This cannot use Fn functions since construct IDs must be resolved immediately
 * 
 * @param namespace The namespace (can contain wildcards)
 * @param appName The application name
 * @param suffix Optional suffix for the ID
 * @returns A string suitable for use as a construct ID
 */
export function createConcreteId(
  namespace: string, 
  appName: string,
  suffix?: string
): string {
  // For construct IDs, we must use string operations, not Fn functions
  // These IDs are used at synthesis time and must be concrete strings
  
  // Basic sanitization for namespace
  const safeNamespace = String(namespace)
    .replace(/\*/g, "wildcard")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
  
  // Basic sanitization for appName
  const safeAppName = String(appName)
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
  
  // Include suffix if provided
  return suffix 
    ? `${safeNamespace}-${safeAppName}-${suffix}`
    : `${safeNamespace}-${safeAppName}`;
}
