# EKS Cluster Provisioning with CDK for Terraform (CDKTF)

This project provisions an EKS Kubernetes cluster on AWS using CDK for Terraform (CDKTF) in TypeScript, with the following features:

- AWS EKS cluster with modern features (1.28 version)
- Configurable VPC and subnets
- Proper IAM roles and policies
- Kubernetes provider configuration
- ArgoCD namespaces for GitOps workflows
- Support for kubernetes-event-exporter for Slack alerts

## Prerequisites

- Node.js v20 or later
- CDKTF CLI installed (`npm install -g cdktf-cli`)
- AWS CLI configured with proper credentials
- Terraform installed

## Project Structure

```
cdktf/
├── lib/
│   ├── eks.ts        # EKS cluster and node group configuration
│   ├── iam.ts        # IAM roles for EKS and node groups
│   └── vpc.ts        # VPC and subnet configuration
├── main.ts           # Main stack definition
├── package.json      # Project dependencies
├── cdktf.json        # CDKTF configuration
└── tsconfig.json     # TypeScript configuration
```

## Configuration

### Environment Variables

- `AWS_KMS_KEY_ARN` - (Optional) KMS key ARN for EKS secret encryption
- `AWS_PROFILE` - (Optional) AWS profile to use
- `AWS_REGION` - (Optional) AWS region to deploy to

## Deployment

### Install Dependencies

```bash
npm install
```

### Generate Terraform Configuration

```bash
npm run synth
```

### Deploy Infrastructure

```bash
npm run deploy
```

### Access Your Cluster

After deployment, use the output command to configure kubectl:

```bash
# Command will be shown in the outputs after deployment
aws eks update-kubeconfig --name layerx-eks --region <your-region>
```

### Clean Up Resources

```bash
npm run destroy
```

## Adding ArgoCD and kubernetes-event-exporter

After the cluster is deployed:

1. Install ArgoCD:
```bash
kubectl create namespace argocd # if not created by Terraform
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

2. Configure kubernetes-event-exporter via ArgoCD:
   - Create an ArgoCD Application pointing to a repository with Helm charts
   - Configure Slack notifications in the values.yaml

## Future Enhancements

- Add Karpenter for autoscaling
- Implement Amazon EBS CSI driver
- Set up monitoring with Prometheus and Grafana
