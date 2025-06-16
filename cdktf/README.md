# CDKTF Implementation for LayerX Home Assignment

This directory contains the CDKTF code that provisions the AWS EKS infrastructure, along with associated components for a GitOps-ready environment.

## Architecture Components

- **VPC**: Custom VPC with public subnets only, supporting both external and internal k8s communication
- **EKS Cluster**: Managed Kubernetes with node groups (version 1.28) without auto-scaling (not using EKS auto mode)
- **Storage**: S3 buckets and DynamoDB tables for application data
- **ArgoCD**: GitOps deployment tool
- **AWS Load Balancer Controller**: For ingress management
- **Event Exporter**: For Kubernetes event monitoring and Slack alerts

> **Note**: This implementation is designed for development purposes. For production, it would need additional components such as private subnets, Karpenter autoscaling, and stricter security measures.

## Prerequisites

- Node.js v20 or later
- CDKTF CLI installed (`npm install -g cdktf-cli`)
- AWS CLI configured with proper credentials
- Terraform installed

## Key Implementation Details

### Module Structure
The codebase is structured into logical modules:
```
cdktf/
├── lib/
│   ├── app-iam/      # Application-specific IAM roles and policies
│   ├── argocd.ts     # ArgoCD installation and configuration
│   ├── aws-load-balancer-controller.ts # AWS LB Controller setup
│   ├── eks-addons.ts # Kubernetes add-ons
│   ├── eks.ts        # EKS cluster and node group configuration
│   ├── providers.ts  # AWS and Kubernetes provider configuration
│   ├── storage.ts    # S3 and DynamoDB resources
│   └── vpc.ts        # VPC and subnet configuration
├── main.ts           # Main stack definition
└── package.json      # Project dependencies
```

### Noteworthy Design Decisions

1. **Dependency Management**: Resources are explicitly ordered with proper dependencies
2. **Finalizer Handling**: Pre-delete hooks in Helm charts to clean up resources properly
3. **IAM with OIDC**: Service accounts use AWS IAM roles via OIDC for secure access
4. **Manual Secret Management**: Some secrets like Slack webhook URLs are managed separately from code

## Manual Configuration Notes

Some resources required manual setup for security or practical reasons:
- Slack webhook URL for event notifications
- ArgoCD repository credentials
- External Secrets integration with AWS Secrets Manager

## Usage Instructions

### Deploy Infrastructure

```bash
npm install
cdktf get      # Important: Download provider schemas first
cdktf apply
```

### Configure kubectl

After successful deployment, configure kubectl to use the new EKS cluster:
```bash
aws eks update-kubeconfig --name layerx-eks --region <your-region>
```

### Access ArgoCD

After deployment:
1. Get the ArgoCD URL:
   ```bash
   kubectl get svc argocd-server -n argocd -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
   ```

2. Access the UI with default credentials:
   - Username: `admin`
   - Password: `argocd`

### Deploy Applications

Deploy the bootstrap application that will configure all other apps:
```bash
kubectl apply -f ../argocd-apps/bootstrap/cluster-apps.yaml
```

### Test Event Notifications

Create a failing pod to test Slack notifications:
```bash
kubectl run test-failure --image=non-existent-image:latest
```

### Clean Up

```bash
cdktf destroy
```

## Debugging Tips

- Check pod status: `kubectl get pods -A`
- View ArgoCD application sync status: `kubectl get applications -A`
- Check event exporter logs: `kubectl logs -n monitoring -l app=event-exporter`
- AWS Load Balancer Controller logs: `kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller`
