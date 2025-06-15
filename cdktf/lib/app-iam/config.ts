import { AppIamConfig } from "./types";

/**
 * Application IAM role configurations
 * 
 * Add new application configurations here and they will automatically
 * be created by the infrastructure pipeline
 */
export const appIamConfigs: AppIamConfig[] = [
  // Event Exporter configuration
  {
    appName: "event-exporter",
    namespace: "monitoring",
    serviceAccount: "event-exporter",
    secretsAccess: ["home-assignments/layerx"],  // Explicit wildcard to match all versions of the secret
    tags: {
      Application: "event-exporter",
      Purpose: "Kubernetes event export to Slack"
    }
  },
  
  // Example application with namespace pattern
  // {
  //   appName: "data-processor",
  //   namespace: "data-processing-*", // Supports any namespace with this prefix
  //   serviceAccount: "data-processor-sa",
  //   s3Access: ["data-lake-bucket"],  // No wildcard needed for S3 - construct adds /* automatically 
  //   sqsAccess: ["data-processing-queue"],  // Exact queue name
  //   secretsAccess: ["app/data-processor*", "shared/config*"],  // Explicit wildcards
  //   tags: {
  //     Application: "data-processor",
  //     Purpose: "Data processing pipeline"
  //   }
  // }

  // Add new application configurations here
];

// No helper functions in config - pure data only
