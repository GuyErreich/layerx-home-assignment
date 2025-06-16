# ArgoCD Applications for LayerX Home Assignment

This directory contains GitOps configurations for applications deployed via ArgoCD. The project uses an "App of Apps" pattern to enable declarative management of all Kubernetes applications.

## Directory Structure

```
argocd-apps/
├── bootstrap/              # Contains the "App of Apps" that deploys all other apps
│   └── cluster-apps.yaml
│
├── event-exporter/         # Event Exporter application
│   ├── Chart.yaml          # Chart definition with dependency
│   ├── README.md           # Documentation
│   ├── application.yaml    # ArgoCD Application definition
│   ├── .helmignore         # Files to exclude from Helm
│   └── values.yaml         # Custom values that override defaults
│
└── ... (other applications)
```

## How It Works

1. The `bootstrap/cluster-apps.yaml` is the master application that should be deployed first
2. It monitors the entire `argocd-apps` directory (except the bootstrap folder itself)
3. When changes are pushed to any application folder, ArgoCD automatically applies them

## Adding a New Application

To add a new application:

1. Create a new directory for your app: `argocd-apps/your-app-name/`
2. Add the necessary files (Chart.yaml, values.yaml, application.yaml)
3. Commit and push to Git
4. The bootstrap application will detect the new app and deploy it

## Updating Applications

To update an existing application:

1. Edit the values or chart version in the appropriate application folder
2. Commit and push to Git
3. ArgoCD will automatically apply the changes

## Initial Deployment

To bootstrap the entire setup:

```bash
# Apply the bootstrap application with the full path
kubectl apply -f argocd-apps/bootstrap/cluster-apps.yaml

# ArgoCD will then handle deploying all other applications
```

## Accessing ArgoCD

1. Get the ArgoCD service URL:
   ```bash
   kubectl get svc argocd-server -n argocd -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
   ```

2. Access the UI with default credentials:
   - Username: `admin`
   - Password: `argocd`

## Testing Event Notifications

The event-exporter application is configured to send notifications to Slack for certain Kubernetes events. To test this:

1. Create a pod with an invalid image to trigger an error:
   ```bash
   kubectl run test-failure --image=non-existent-image:latest
   ```

2. Check that the event is detected:
   ```bash
   kubectl get events --sort-by='.lastTimestamp' | grep "Failed"
   ```

3. Verify that a notification appears in the configured Slack channel

## Secret Management

Some secrets like Slack webhook URLs are intentionally managed outside the GitOps workflow for security reasons, as would be appropriate in a real-world scenario.
