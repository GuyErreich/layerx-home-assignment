import { Construct } from "constructs";
import { StorageClass } from "../.gen/providers/kubernetes/storage-class";

// Simplified interface as we no longer create a PVC here
export function createEbsStorageClass(scope: Construct) {
  // Create a StorageClass that uses the AWS EBS CSI driver
  // Note: Using native CDKTF construct for StorageClass
  const ebsStorageClass = new StorageClass(scope, "ebs-sc-gp3", {
    metadata: {
      name: "ebs-sc-gp3",
      annotations: {
        "storageclass.kubernetes.io/is-default-class": "true", // Make this the default storage class
      },
    },
    storageProvisioner: "ebs.csi.aws.com",
    volumeBindingMode: "Immediate", // Using Immediate provisioning to avoid delayed binding issues
    allowVolumeExpansion: true,
    parameters: {
      type: "gp3",
      encrypted: "true",
      fsType: "ext4",
      // AWS GP3 volume parameters with correct limits
      // For GP3, we can specify absolute IOPS instead of IOPS per GB
      iops: "3000", // Base IOPS for gp3 (min 3000)
      throughput: "125", // Base throughput for gp3 (min 125)
    },
    reclaimPolicy: "Delete",
  });

  return ebsStorageClass;
}
