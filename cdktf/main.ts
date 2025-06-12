import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, S3Backend } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws";
import { KubernetesProvider } from "@cdktf/provider-kubernetes";
import { createVpc } from "./lib/vpc";
import { createIamRoles } from "./lib/iam";
import { createEks } from "./lib/eks";

class LayerxEksStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // S3 Backend for state file
    new S3Backend(this, {
      bucket: "your-tf-state-bucket", // <-- Change to your S3 bucket name
      key: "layerx-eks/terraform.tfstate",
      region: "us-east-1", // or use your preferred region
      encrypt: true,
      dynamodbTable: "your-tf-lock-table", // <-- Optional: for state locking
    });

    // AWS Provider
    new AwsProvider(this, "aws", {});

    // VPC & Subnets
    const { vpc, subnet1, subnet2 } = createVpc(this);

    // IAM Roles
    const { eksRole, nodeRole } = createIamRoles(this);

    // EKS Cluster & Node Group
    const { cluster } = createEks(this, eksRole.arn, nodeRole.arn, [subnet1.id, subnet2.id]);

    // Kubernetes Provider (to create namespaces)
    new KubernetesProvider(this, "k8s", {
      host: cluster.endpoint,
      token: cluster.kubeconfig[0].token,
      clusterCaCertificate: cluster.kubeconfig[0].certificateAuthorityData,
    });

    // Outputs
    new TerraformOutput(this, "cluster_name", { value: cluster.name });
    new TerraformOutput(this, "kubeconfig", { value: cluster.kubeconfigRaw });
  }
}

const app = new App();
new LayerxEksStack(app, "layerx-eks-stack");
app.synth();
