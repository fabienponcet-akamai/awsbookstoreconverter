terraform {
  required_version = ">= 1.0"

  required_providers {
    linode = {
      source  = "linode/linode"
      version = "~> 2.9"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.24"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  # Optional: Configure backend for state storage
  # backend "s3" {
  #   bucket   = "bookstore-terraform-state"
  #   key      = "bookstore/terraform.tfstate"
  #   region   = "us-east-1"
  #   endpoint = "us-east-1.linodeobjects.com"
  #   skip_credentials_validation = true
  #   skip_requesting_account_id  = true
  #   skip_metadata_api_check     = true
  # }
}

# Linode Provider
provider "linode" {
  token = var.linode_token
}

# Kubernetes Provider (configured after LKE cluster creation)
provider "kubernetes" {
  host                   = module.lke.cluster_endpoint
  token                  = module.lke.cluster_token
  cluster_ca_certificate = base64decode(module.lke.cluster_ca_certificate)
}

# Helm Provider
provider "helm" {
  kubernetes {
    host                   = module.lke.cluster_endpoint
    token                  = module.lke.cluster_token
    cluster_ca_certificate = base64decode(module.lke.cluster_ca_certificate)
  }
}

# Kubectl Provider
provider "kubectl" {
  host                   = module.lke.cluster_endpoint
  token                  = module.lke.cluster_token
  cluster_ca_certificate = base64decode(module.lke.cluster_ca_certificate)
  load_config_file       = false
}
