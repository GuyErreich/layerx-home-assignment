import { Construct } from "constructs";
import { IamRole, IamRolePolicyAttachment } from "@cdktf/provider-aws";

export interface EksIamRoles {
  eksRole: IamRole;
  nodeRole: IamRole;
}

export function createIamRoles(scope: Construct): EksIamRoles {
  const eksRole = new IamRole(scope, "eksRole", {
    name: "layerx-eks-cluster-role",
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "eks.amazonaws.com" },
        },
      ],
    }),
  });
  new IamRolePolicyAttachment(scope, "eksServicePolicy", {
    role: eksRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
  });

  const nodeRole = new IamRole(scope, "nodeRole", {
    name: "layerx-eks-node-role",
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "ec2.amazonaws.com" },
        },
      ],
    }),
  });
  new IamRolePolicyAttachment(scope, "nodePolicy", {
    role: nodeRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
  });
  new IamRolePolicyAttachment(scope, "cniPolicy", {
    role: nodeRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
  });
  new IamRolePolicyAttachment(scope, "registryPolicy", {
    role: nodeRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  });

  return { eksRole, nodeRole };
}
