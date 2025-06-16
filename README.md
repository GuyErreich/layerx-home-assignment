# LayerX Home Assignment: GitOps-Ready EKS Infrastructure

This project demonstrates a GitOps-friendly AWS EKS environment with ArgoCD for application deployment and the AWS Load Balancer Controller for ingress. The infrastructure is managed using CDKTF (Cloud Development Kit for Terraform) for infrastructure-as-code best practices.

## Key Features and Design Decisions

### Architecture

- **CDKTF for IaC**: Using TypeScript with CDKTF provides type safety and leverages existing Terraform providers while maintaining code reusability
- **VPC Architecture**: Configured with public subnets only for both external access and internal Kubernetes communication
- **EKS with Managed Node Groups**: Using managed node groups without auto-scaling (not using EKS auto mode), with plans to integrate Karpenter for autoscaling in the future
- **GitOps with ArgoCD**: Enables declarative, version-controlled application deployment
- **AWS Load Balancer Controller**: Manages AWS ALB/NLB resources for Kubernetes ingress traffic
- **Event Monitoring**: Slack integration for important cluster events to improve observability

> **Note**: This implementation is designed for development purposes and would require additional modifications to be production-ready.

### Implementation Decisions

- **Modular Design**: Infrastructure code separated into logical modules (VPC, EKS, Storage, ArgoCD, etc.) for maintainability
- **Proper Dependency Management**: Resources are explicitly dependent to ensure correct creation/deletion order
- **Finalizer Handling**: Pre-delete hooks for ArgoCD and AWS Load Balancer Controller to properly clean up finalizers
- **Security Best Practices**: Least-privilege IAM roles and OIDC provider integration for service accounts
- **Manual Secret Management**: Some secrets (like Slack webhook URLs) are managed manually, which is often realistic in environments where you want to separate sensitive config from code

## Deployment Instructions

### Prerequisites

- AWS CLI configured with appropriate permissions
- kubectl installed and configured
- Node.js and npm installed
- cdktf CLI installed

### Deployment Steps

1. **Deploy Infrastructure**:
   ```
   cd cdktf
   npm install
   cdktf get      # Important: Download provider schemas first
   cdktf apply
   ```

2. **Configure kubectl to use the new EKS cluster**:
   ```
   aws eks update-kubeconfig --name layerx-eks --region <your-region>
   ```

3. **Deploy Applications with ArgoCD**:
   ```
   kubectl apply -f argocd-apps/bootstrap/cluster-apps.yaml
   ```

3. **Access ArgoCD UI**:
   ```
   # Get the ArgoCD service URL
   kubectl get svc argocd-server -n argocd -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
   ```
   
   Then access this URL in your browser. Default credentials:
   - Username: `admin`
   - Password: `argocd`
   
   For security in a production environment, change the default password immediately.

### Testing Event Notifications

To test the event notification system and see alerts in Slack:

1. **Create a failing pod**:
   ```
   kubectl run test-failure --image=non-existent-image:latest
   ```

2. **Watch for events**:
   ```
   kubectl get events --sort-by='.lastTimestamp'
   ```

   You should receive a Slack notification about the failed pod creation.

## Cleanup

```
cdktf destroy
```

Note: In case of stuck resources during deletion, some manual cleanup steps might be needed. The code includes pre-delete hooks to minimize this, but finalizers and cross-resource dependencies sometimes require manual intervention.
