import { Construct } from "constructs";
import { IamRole } from "../.gen/providers/aws/iam-role";
import { IamRolePolicyAttachment } from "../.gen/providers/aws/iam-role-policy-attachment";
import { IamPolicy } from "../.gen/providers/aws/iam-policy";
import { DataAwsCallerIdentity } from "../.gen/providers/aws/data-aws-caller-identity";
import { Fn, Token } from "cdktf";
import { Config } from "./config";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { DataAwsIamPolicyDocument } from "../.gen/providers/aws/data-aws-iam-policy-document";
import { IamOpenidConnectProvider } from "../.gen/providers/aws/iam-openid-connect-provider";

export interface EksIamRoles {
  eksRole: IamRole;
  nodeRole: IamRole;
  ebsCsiDriverRole?: IamRole;
  lbControllerRole?: IamRole;
  updateEbsCsiDriverRoleTrustPolicy?: (cluster: EksCluster) => void;
  updateLbControllerRoleTrustPolicy?: (cluster: EksCluster) => void;
  createOidcProvider?: (cluster: EksCluster) => IamOpenidConnectProvider;
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

  // Create IAM role for AWS Load Balancer Controller with a temporary trust policy
  // It will be updated once the EKS cluster is created with proper OIDC trust configuration
  const lbControllerRole = new IamRole(scope, "lbControllerRole", {
    name: Config.iam.lbControllerRoleName,
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

  // Create the AWS Load Balancer Controller policy
  const lbControllerPolicy = new IamPolicy(scope, "lbControllerPolicy", {
    name: Fn.join("-", [Config.iam.lbControllerRoleName, "policy"]),
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "CreateELBServiceLinkedRole",
          Effect: "Allow",
          Action: [
            "iam:CreateServiceLinkedRole"
          ],
          Resource: "*",
          Condition: {
            StringEquals: {
              "iam:AWSServiceName": "elasticloadbalancing.amazonaws.com"
            }
          }
        },
        {
          Sid: "ReadEC2andELBResources",
          Effect: "Allow",
          Action: [
            "ec2:DescribeAccountAttributes",
            "ec2:DescribeAddresses",
            "ec2:DescribeAvailabilityZones",
            "ec2:DescribeInternetGateways",
            "ec2:DescribeVpcs",
            "ec2:DescribeVpcPeeringConnections",
            "ec2:DescribeSubnets",
            "ec2:DescribeSecurityGroups",
            "ec2:DescribeInstances",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DescribeTags",
            "ec2:GetCoipPoolUsage",
            "ec2:DescribeCoipPools",
            "elasticloadbalancing:DescribeLoadBalancers",
            "elasticloadbalancing:DescribeLoadBalancerAttributes",
            "elasticloadbalancing:DescribeListeners",
            "elasticloadbalancing:DescribeListenerCertificates",
            "elasticloadbalancing:DescribeSSLPolicies",
            "elasticloadbalancing:DescribeRules",
            "elasticloadbalancing:DescribeTargetGroups",
            "elasticloadbalancing:DescribeTargetGroupAttributes",
            "elasticloadbalancing:DescribeTargetHealth",
            "elasticloadbalancing:DescribeTags"
          ],
          Resource: "*"
        },
        {
          Sid: "AccessRelatedAWSServices",
          Effect: "Allow",
          Action: [
            "cognito-idp:DescribeUserPoolClient",
            "acm:ListCertificates",
            "acm:DescribeCertificate",
            "iam:ListServerCertificates",
            "iam:GetServerCertificate",
            "waf-regional:GetWebACL",
            "waf-regional:GetWebACLForResource",
            "waf-regional:AssociateWebACL",
            "waf-regional:DisassociateWebACL",
            "wafv2:GetWebACL",
            "wafv2:GetWebACLForResource",
            "wafv2:AssociateWebACL",
            "wafv2:DisassociateWebACL",
            "shield:GetSubscriptionState",
            "shield:DescribeProtection",
            "shield:CreateProtection",
            "shield:DeleteProtection"
          ],
          Resource: "*"
        },
        {
          Sid: "ManageSecurityGroupRules",
          Effect: "Allow",
          Action: [
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupIngress"
          ],
          Resource: "*"
        },
        {
          Sid: "CreateSecurityGroups",
          Effect: "Allow",
          Action: [
            "ec2:CreateSecurityGroup"
          ],
          Resource: "*"
        },
        {
          Sid: "TagNewSecurityGroups",
          Effect: "Allow",
          Action: [
            "ec2:CreateTags"
          ],
          Resource: "arn:aws:ec2:*:*:security-group/*",
          Condition: {
            StringEquals: {
              "ec2:CreateAction": "CreateSecurityGroup"
            },
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "false"
            }
          }
        },
        {
          Sid: "ManageSecurityGroupTags",
          Effect: "Allow",
          Action: [
            "ec2:CreateTags",
            "ec2:DeleteTags"
          ],
          Resource: "arn:aws:ec2:*:*:security-group/*",
          Condition: {
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
            }
          }
        },
        {
          Sid: "ManageSecurityGroups",
          Effect: "Allow",
          Action: [
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupIngress",
            "ec2:DeleteSecurityGroup"
          ],
          Resource: "*",
          Condition: {
            Null: {
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
            }
          }
        },
        {
          Sid: "CreateLoadBalancersAndTargetGroups",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:CreateLoadBalancer",
            "elasticloadbalancing:CreateTargetGroup"
          ],
          Resource: "*",
          Condition: {
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "false"
            }
          }
        },
        {
          Sid: "ManageELBListenersAndRules",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:CreateListener",
            "elasticloadbalancing:DeleteListener",
            "elasticloadbalancing:CreateRule",
            "elasticloadbalancing:DeleteRule"
          ],
          Resource: "*"
        },
        {
          Sid: "ManageELBAndTargetGroupTags",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:AddTags",
            "elasticloadbalancing:RemoveTags"
          ],
          Resource: [
            "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
            "arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*",
            "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*"
          ],
          Condition: {
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
            }
          }
        },
        {
          Sid: "ManageListenerAndRuleTags",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:AddTags",
            "elasticloadbalancing:RemoveTags"
          ],
          Resource: [
            "arn:aws:elasticloadbalancing:*:*:listener/net/*/*/*",
            "arn:aws:elasticloadbalancing:*:*:listener/app/*/*/*",
            "arn:aws:elasticloadbalancing:*:*:listener-rule/net/*/*/*",
            "arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*"
          ]
        },
        {
          Sid: "ManageELBAndTargetGroupSettings",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:ModifyLoadBalancerAttributes",
            "elasticloadbalancing:SetIpAddressType",
            "elasticloadbalancing:SetSecurityGroups",
            "elasticloadbalancing:SetSubnets",
            "elasticloadbalancing:DeleteLoadBalancer",
            "elasticloadbalancing:ModifyTargetGroup",
            "elasticloadbalancing:ModifyTargetGroupAttributes",
            "elasticloadbalancing:DeleteTargetGroup"
          ],
          Resource: "*",
          Condition: {
            Null: {
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
            }
          }
        },
        // Add permissions for AddTags specifically for ArgoCD resources
        // This is more secure than a blanket "*" permission
        {
          Sid: "ManageArgoCDResourceTags",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:AddTags"
          ],
          Resource: [
            "arn:aws:elasticloadbalancing:*:*:targetgroup/k8s-argocd-*/*",
            "arn:aws:elasticloadbalancing:*:*:loadbalancer/*/k8s-argocd-*/*"
          ]
        },
        {
          Sid: "ManageTargetGroupRegistrations",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:RegisterTargets",
            "elasticloadbalancing:DeregisterTargets"
          ],
          Resource: "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*"
        },
        {
          Sid: "ManageListenersAndRules",
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:SetWebAcl",
            "elasticloadbalancing:ModifyListener",
            "elasticloadbalancing:AddListenerCertificates",
            "elasticloadbalancing:RemoveListenerCertificates",
            "elasticloadbalancing:ModifyRule"
          ],
          Resource: "*"
        }
      ]
    })
  });

  // Attach the AWS Load Balancer Controller policy to the role
  new IamRolePolicyAttachment(scope, "lbControllerPolicyAttachment", {
    policyArn: lbControllerPolicy.arn,
    role: lbControllerRole.name
  });

  // Get AWS account ID for constructing the service account role ARN
  const caller = new DataAwsCallerIdentity(scope, "current-identity", {});

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
    // Extract the OIDC URL - CDKTF handles this as a token internally
    const oidcIssuerUrl = cluster.identity.get(0).oidc.get(0).issuer;
    const oidcIssuer = Fn.replace(oidcIssuerUrl, "https://", "");
    const oidcIssuerArn = Fn.join("", [
      "arn:aws:iam::",
      caller.accountId,
      ":oidc-provider/",
      oidcIssuer
    ]);
   const conditionVar = Fn.join("", [
      oidcIssuer,
      ":sub"
    ])

    // Create IAM policy document for EBS CSI Driver with proper OIDC trust relationship
    // Use string interpolation with the Fn.replace function to ensure https:// is removed
    const ebsCsiDriverTrustPolicy = new DataAwsIamPolicyDocument(scope, "ebsCsiDriverTrustPolicy", {
      statement: [{
        actions: ["sts:AssumeRoleWithWebIdentity"],
        effect: "Allow",
        principals: [{
          type: "Federated",
          identifiers: [oidcIssuerArn]
        }],
        condition: [{
          test: "StringEquals",
          variable: conditionVar,
          values: ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
        }]
      }]
    });
    
    // Update the role's assume role policy
    ebsCsiDriverRole.assumeRolePolicy = ebsCsiDriverTrustPolicy.json;
  };
  
  // Function to update the Load Balancer Controller role trust policy with the correct OIDC provider
  const updateLbControllerRoleTrustPolicy = (cluster: EksCluster) => {
    // Extract the OIDC URL - CDKTF handles this as a token internally
    const oidcIssuerUrl = cluster.identity.get(0).oidc.get(0).issuer;
    const oidcIssuer = Fn.replace(oidcIssuerUrl, "https://", "");
    const oidcIssuerArn = Fn.join("", [
      "arn:aws:iam::",
      caller.accountId,
      ":oidc-provider/",
      oidcIssuer
    ]);
    const conditionVar = Fn.join("", [
      oidcIssuer,
      ":sub"
    ]);
    
    // Create IAM policy document for Load Balancer Controller with proper OIDC trust relationship
    const lbControllerTrustPolicy = new DataAwsIamPolicyDocument(scope, "lbControllerTrustPolicy", {
      statement: [{
        actions: ["sts:AssumeRoleWithWebIdentity"],
        effect: "Allow",
        principals: [{
          type: "Federated",
          identifiers: [oidcIssuerArn]
        }],
        condition: [{
          test: "StringEquals",
          variable: conditionVar,
          values: ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
        }]
      }]
    });
    
    // Update the role's assume role policy
    lbControllerRole.assumeRolePolicy = lbControllerTrustPolicy.json;
  };

  // Function to create the OIDC provider in AWS IAM
  // This is critical for service accounts to assume IAM roles
  const createOidcProvider = (cluster: EksCluster): IamOpenidConnectProvider => {
    // Extract OIDC issuer URL from the EKS cluster - keep WITH https:// for this resource
    const oidcIssuerUrl = cluster.identity.get(0).oidc.get(0).issuer;
    
    // Get the thumbprint - in production, you'd want to fetch this dynamically
    // For now, we'll use a hardcoded thumbprint for the AWS OIDC provider
    // More info: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc_verify-thumbprint.html
    // NOTE: This is not ideal and in production should be retrieved dynamically
    const thumbprint = ["9e99a48a9960b14926bb7f3b02e22da2b0ab7280"];
    
    // Create the IAM OIDC provider - IMPORTANT: AWS requires full URL WITH https:// here
    // This is the opposite of the trust policy which requires NO https:// prefix
    return new IamOpenidConnectProvider(scope, "eks-oidc-provider", {
      clientIdList: ["sts.amazonaws.com"],
      thumbprintList: thumbprint,
      url: oidcIssuerUrl,
      tags: {
        Name: Fn.join("-", [Config.cluster.name, "oidc-provider"]),
      }
    });
  };

  return { 
    eksRole, 
    nodeRole, 
    ebsCsiDriverRole,
    lbControllerRole, 
    updateEbsCsiDriverRoleTrustPolicy,
    updateLbControllerRoleTrustPolicy,
    createOidcProvider
  };
}
