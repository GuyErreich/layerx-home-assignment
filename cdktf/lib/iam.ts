import { Construct } from "constructs";
import { IamRole } from "../.gen/providers/aws/iam-role";
import { IamRolePolicyAttachment } from "../.gen/providers/aws/iam-role-policy-attachment";
import { IamPolicy } from "../.gen/providers/aws/iam-policy";
import { DataAwsCallerIdentity } from "../.gen/providers/aws/data-aws-caller-identity";
import { Fn, Token } from "cdktf";
import { Config } from "./config";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { DataAwsIamPolicyDocument } from "../.gen/providers/aws/data-aws-iam-policy-document";

export interface EksIamRoles {
  eksRole: IamRole;
  nodeRole: IamRole;
  ebsCsiDriverRole?: IamRole;
  updateEbsCsiDriverRoleTrustPolicy?: (cluster: EksCluster) => void;
}

export function createIamRoles(scope: Construct): EksIamRoles {
  const eksRole = new IamRole(scope, "eksRole", {
    name: Config.iam.eksRoleName,
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
    name: Config.iam.nodeRoleName,
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

  // Attach required policies for EKS worker nodes
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
  
  // Add SSM policy for troubleshooting
  new IamRolePolicyAttachment(scope, "ssmPolicy", {
    role: nodeRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });

  // NOTE: We have removed the AWS Load Balancer Controller IAM role and policy since
  // these will be created as part of the ArgoCD deployment process
  // When deploying the AWS Load Balancer Controller through ArgoCD,
  // ensure you create the proper IAM role with OIDC provider trust relationship

  // Get AWS account ID for constructing the service account role ARN
  const caller = new DataAwsCallerIdentity(scope, "current", {});

  // Create IAM role for AWS EBS CSI Driver with a temporary trust policy
  // It will be updated once the EKS cluster is created with proper OIDC trust configuration
  const ebsCsiDriverRole = new IamRole(scope, "ebsCsiDriverRole", {
    name: Config.iam.ebsCsiDriverRoleName,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "eks.amazonaws.com"
          },
          Action: "sts:AssumeRole"
        }
      ]
    })
  });

  // Attach the AWS managed EBS CSI Driver policy to the role
  new IamRolePolicyAttachment(scope, "ebsCsiDriverPolicyAttachment", {
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy",
    role: ebsCsiDriverRole.name
  });
  
  // Function to update the EBS CSI Driver role trust policy with the correct OIDC provider
  const updateEbsCsiDriverRoleTrustPolicy = (cluster: EksCluster) => {
    const oidcProvider = cluster.identity.get(0).oidc.get(0).issuer.replace("https://", "");
    
    // Create IAM policy document for EBS CSI Driver with proper OIDC trust relationship
    const ebsCsiDriverTrustPolicy = new DataAwsIamPolicyDocument(scope, "ebsCsiDriverTrustPolicy", {
      statement: [{
        actions: ["sts:AssumeRoleWithWebIdentity"],
        effect: "Allow",
        principals: [{
          type: "Federated",
          identifiers: [`arn:aws:iam::${caller.accountId}:oidc-provider/${oidcProvider}`]
        }],
        condition: [{
          test: "StringEquals",
          variable: `${oidcProvider}:sub`,
          values: ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
        }]
      }]
    });
    
    // Update the role's assume role policy
    ebsCsiDriverRole.assumeRolePolicy = ebsCsiDriverTrustPolicy.json;
  };

  return { 
    eksRole, 
    nodeRole, 
    ebsCsiDriverRole, 
    updateEbsCsiDriverRoleTrustPolicy 
  };
}
