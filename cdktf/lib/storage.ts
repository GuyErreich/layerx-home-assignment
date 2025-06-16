import { Construct } from "constructs";
import { StorageClass } from "../.gen/providers/kubernetes/storage-class";

/**
 * Creates EBS GP3 storage class for Kubernetes persistent volumes
 * @param scope CDKTF construct scope
 * @returns StorageClass resource
 */
export function createEbsStorageClass(scope: Construct): StorageClass {
  const ebsStorageClass = new StorageClass(scope, "ebs-sc-gp3", {
    metadata: {
      name: "ebs-sc-gp3",
      annotations: {
        "storageclass.kubernetes.io/is-default-class": "true",
      },
    },
    storageProvisioner: "ebs.csi.aws.com",
    volumeBindingMode: "Immediate",
    allowVolumeExpansion: true,
    parameters: {
      type: "gp3",
      encrypted: "true",
      fsType: "ext4",
      iops: "3000",
      throughput: "125",
    },
    reclaimPolicy: "Delete",
  });

  return ebsStorageClass;
}
