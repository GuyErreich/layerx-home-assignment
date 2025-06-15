# Event Exporter

This chart wraps the Bitnami Kubernetes Event Exporter chart and provides custom configuration.

## How It Works

This setup follows the "chart as dependency" pattern where:

1. We define our own `Chart.yaml` that declares the base chart as a dependency
2. We customize the chart with our own `values.yaml` file
3. ArgoCD monitors this folder in Git and applies changes automatically

## Updating Values

To update the configuration:

1. Edit the `values.yaml` file in this directory
2. Commit and push the changes to your Git repository
3. ArgoCD will detect the changes and apply them automatically

## How to Deploy

The associated ArgoCD Application manifest (`application.yaml`) points to this directory and will apply:
- The Chart.yaml dependency definition
- The values.yaml customizations

## Adding New Features

If you need to add a new feature:

1. Update the `values.yaml` file with new configuration
2. If needed, update the chart dependency version in `Chart.yaml`
3. Commit and push the changes

## Updating the Chart Version

To upgrade the base chart version:

1. Edit the `Chart.yaml` file
2. Change the version number under the dependencies section
3. Commit and push the changes
4. ArgoCD will detect the change and upgrade the chart
