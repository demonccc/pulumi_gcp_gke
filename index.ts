import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const name = 'helloworld';
const config = new pulumi.Config();
//const openAPI = config.requireObject<any>('openAPI');
const openAPI = '{"swagger": "2.0","info": {"description": "A simple Google Cloud Endpoints API example.","title": "Endpoints Example","version": "1.0.0"},"host": "helloword.endpoints.devops-gcp-luifa.cloud.goog"}';

// Create Cloud Endpoint Service

const ceSvc = new gcp.endpoints.Service("helloworld", {serviceName: "helloword.endpoints.devops-gcp-luifa.cloud.goog",
	openapiConfig: openAPI}); 
		
// Create a GKE cluster
const engineVersion = gcp.container.getEngineVersions().then(v => v.latestMasterVersion);
const cluster = new gcp.container.Cluster(name, {
    initialNodeCount: 2,
    minMasterVersion: engineVersion,
    nodeVersion: engineVersion,
    nodeConfig: {
        machineType: "n1-standard-1",
        oauthScopes: [
            "https://www.googleapis.com/auth/compute",
            "https://www.googleapis.com/auth/devstorage.read_only",
            "https://www.googleapis.com/auth/logging.write",
            "https://www.googleapis.com/auth/monitoring"
        ],
    },
});

// Export the Cluster name
export const clusterName = cluster.name;

// Manufacture a GKE-style kubeconfig. Note that this is slightly "different"
// because of the way GKE requires gcloud to be in the picture for cluster
// authentication (rather than using the client cert/key directly).
export const kubeconfig = pulumi.
    all([ cluster.name, cluster.endpoint, cluster.masterAuth ]).
    apply(([ name, endpoint, masterAuth ]) => {
        const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
    });

// Create a Kubernetes provider instance that uses our cluster from above.
const clusterProvider = new k8s.Provider(name, {
    kubeconfig: kubeconfig,
    });

    // Create a Kubernetes Namespace
const ns = new k8s.core.v1.Namespace(name, {}, { provider: clusterProvider });

// Export the Namespace name
export const namespaceName = ns.metadata.apply(m => m.name);

// Create a NGINX Deployment
const appLabels = { appClass: name };
const deployment = new k8s.apps.v1.Deployment(name,
    {
        metadata: {
            namespace: namespaceName,
            labels: appLabels,
        },
        spec: {
            replicas: 1,
            selector: { matchLabels: appLabels },
            template: {
                metadata: {
                    labels: appLabels,
                },
                spec: {
                    containers: [
			{
		            name: "esp",
			    image: "gcr.io/endpoints-release/endpoints-runtime:1",
		            args: [
				    "--http_port", "8081",
				    "--backend", "127.0.0.1:80",
				    "--service", "hellowo  rd.endpoints.devops-gcp-luifa.cloud.goog",
				    "--rollout_strategy", "managed"
                                  ],
		            ports: [{ containerPort: 8081 }]
			},
                        {
                            name: name,
                            image: "nginx:latest",
                            ports: [{ name: "http", containerPort: 80 }]
                        }
                    ],
                }
            }
        },
    },
    {
        provider: clusterProvider,
    }
);

// Export the Deployment name
export const deploymentName = deployment.metadata.apply(m => m.name);

// Create a LoadBalancer Service for the NGINX Deployment
const service = new k8s.core.v1.Service(name,
    {
        metadata: {
            labels: appLabels,
            namespace: namespaceName,
        },
        spec: {
            type: "LoadBalancer",
            ports: [{ 
			    port: 80, 
			    targetPort: 8081,
		            protocol: "TCP",
		            name: "http"
		    }],
            selector: appLabels,
        },
    },
    {
        provider: clusterProvider,
    }
);

// Export the Service name and public LoadBalancer endpoint
export const serviceName = service.metadata.apply(m => m.name);
export const servicePublicIP = service.status.apply(s => s.loadBalancer.ingress[0].ip)
