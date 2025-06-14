import { Construct } from "constructs";
import { Vpc } from "../.gen/providers/aws/vpc";
import { Subnet } from "../.gen/providers/aws/subnet";
import { InternetGateway } from "../.gen/providers/aws/internet-gateway";
import { RouteTable } from "../.gen/providers/aws/route-table";
import { Route } from "../.gen/providers/aws/route";
import { RouteTableAssociation } from "../.gen/providers/aws/route-table-association";
import { DataAwsRegion } from "../.gen/providers/aws/data-aws-region";
import { DataAwsAvailabilityZones } from "../.gen/providers/aws/data-aws-availability-zones";

export interface VpcModuleConfig {
  name: string;
  cidr: string;
  azs: number;  // Number of availability zones to spread across
  publicSubnets: boolean;  // Whether to create public subnets
  eksClusterName?: string;  // Optional EKS cluster name for tagging
}

export interface VpcModuleOutput {
  // TODO: return proper needed values not the full VPC object
  vpc: Vpc;
  publicSubnets: Subnet[];
  internetGateway?: InternetGateway;
  publicRouteTable?: RouteTable;
}

export class VpcModule extends Construct {
  public readonly vpc: Vpc;
  public readonly publicSubnets: Subnet[] = [];
  public readonly internetGateway?: InternetGateway;
  public readonly publicRouteTable?: RouteTable;

  constructor(scope: Construct, id: string, config: VpcModuleConfig) {
    super(scope, id);

    // Get current AWS region
    const region = new DataAwsRegion(this, "current");
    
    // Get available AZs in the region
    const availableAZs = new DataAwsAvailabilityZones(this, "available", {
      state: "available",
    });

    // Create VPC
    this.vpc = new Vpc(this, "vpc", {
      cidrBlock: config.cidr,
      enableDnsSupport: true,    // Required for EKS
      enableDnsHostnames: true,  // Required for EKS
      tags: {
        Name: `${config.name}-vpc`,
        ...(config.eksClusterName && {
          [`kubernetes.io/cluster/${config.eksClusterName}`]: "owned"  // Required for EKS cluster
        })
      },
    });

    // Create subnets, internet gateway, and route tables if public subnets are requested
    if (config.publicSubnets) {
      // Create Internet Gateway
      this.internetGateway = new InternetGateway(this, "igw", {
        vpcId: this.vpc.id,
        tags: {
          Name: `${config.name}-igw`,
        },
      });

      // Create public route table
      this.publicRouteTable = new RouteTable(this, "public-rtb", {
        vpcId: this.vpc.id,
        tags: {
          Name: `${config.name}-public-rtb`,
        },
      });

      // Add route to Internet Gateway
      new Route(this, "public-route", {
        routeTableId: this.publicRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: this.internetGateway.id,
      });

      // Calculate subnet CIDR blocks (assuming /20 subnets in a /16 VPC)
      const vpcCidr = config.cidr;
      const vpcPrefix = vpcCidr.split("/")[0]; // e.g., "10.0.0.0"
      const vpcParts = vpcPrefix.split(".");
      const thirdOctet = parseInt(vpcParts[2]);

      // Create public subnets across AZs
      for (let i = 0; i < config.azs; i++) {
        // Calculate CIDR for this subnet
        const subnetCidr = `${vpcParts[0]}.${vpcParts[1]}.${thirdOctet + i * 16}.0/20`;
        
        const subnet = new Subnet(this, `public-subnet-${i+1}`, {
          vpcId: this.vpc.id,
          cidrBlock: subnetCidr,
          availabilityZone: `${region.name}${String.fromCharCode(97 + i)}`, // a, b, c, ...
          mapPublicIpOnLaunch: true,
          tags: {
            Name: `${config.name}-public-subnet-${i+1}`,
            "kubernetes.io/role/elb": "1",                   // Required for AWS Load Balancer Controller
            ...(config.eksClusterName && {
              [`kubernetes.io/cluster/${config.eksClusterName}`]: "owned"  // Required for EKS to identify the subnet
            })
          },
        });

        // Associate with public route table
        new RouteTableAssociation(this, `public-rta-${i+1}`, {
          subnetId: subnet.id,
          routeTableId: this.publicRouteTable.id,
        });

        this.publicSubnets.push(subnet);
      }
    }
  }

  public getOutputs(): VpcModuleOutput {
    return {
      vpc: this.vpc,
      publicSubnets: this.publicSubnets,
      internetGateway: this.internetGateway,
      publicRouteTable: this.publicRouteTable
    };
  }
}
