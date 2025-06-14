/**
 * Centralized configuration file for the CDKTF EKS project
 * Use this file to store constant values that are used across multiple modules
 */

export const Config = {
  // AWS Region
  region: "eu-central-1", // Change this to your preferred region
  
  // Cluster configuration
  cluster: {
    name: "layerx-eks",
    version: "1.31", // Kubernetes version
  },
  
  // VPC configuration
  vpc: {
    name: "layerx-eks-vpc",
    cidrBlock: "10.0.0.0/16",
    numSubnets: 2,
  },
  
  // IAM roles naming
  iam: {
    eksRoleName: "layerx-eks-cluster-role",
    nodeRoleName: "layerx-eks-node-role",
    ebsCsiDriverRoleName: "layerx-eks-ebs-csi-driver-role",
    lbControllerRoleName: "layerx-eks-lb-controller-role",
    adminRoleName: "layerx-eks-admin-role",
  },
  
  // Node group configuration
  nodeGroup: {
    instanceType: "t3.micro",
    diskSize: 20,
    minSize: 2,
    desiredSize: 3,
    maxSize: 4,
  },

  // Namespaces to create
  namespaces: ["argocd", "monitoring"],
};
