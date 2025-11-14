output "main_db_host" {
  description = "Main database connection host"
  value       = "bookstore-main-rw.${var.namespace}.svc.cluster.local"
}

output "main_db_port" {
  description = "Main database port"
  value       = "5432"
}

output "main_db_name" {
  description = "Main database name"
  value       = var.main_db_name
}

output "main_db_user" {
  description = "Main database user"
  value       = var.main_db_user
}

output "main_db_connection_string" {
  description = "Main database connection string"
  value       = "postgresql://${var.main_db_user}:${var.main_db_password}@bookstore-main-rw.${var.namespace}.svc.cluster.local:5432/${var.main_db_name}?sslmode=require"
  sensitive   = true
}

output "search_db_host" {
  description = "Search database connection host"
  value       = "bookstore-search-rw.${var.namespace}.svc.cluster.local"
}

output "search_db_port" {
  description = "Search database port"
  value       = "5432"
}

output "search_db_name" {
  description = "Search database name"
  value       = var.search_db_name
}

output "search_db_user" {
  description = "Search database user"
  value       = var.search_db_user
}

output "search_db_connection_string" {
  description = "Search database connection string"
  value       = "postgresql://${var.search_db_user}:${var.search_db_password}@bookstore-search-rw.${var.namespace}.svc.cluster.local:5432/${var.search_db_name}?sslmode=require"
  sensitive   = true
}

output "graph_db_host" {
  description = "Graph database connection host"
  value       = "bookstore-graph-rw.${var.namespace}.svc.cluster.local"
}

output "graph_db_port" {
  description = "Graph database port"
  value       = "5432"
}

output "graph_db_name" {
  description = "Graph database name"
  value       = var.graph_db_name
}

output "graph_db_user" {
  description = "Graph database user"
  value       = var.graph_db_user
}

output "graph_db_connection_string" {
  description = "Graph database connection string"
  value       = "postgresql://${var.graph_db_user}:${var.graph_db_password}@bookstore-graph-rw.${var.namespace}.svc.cluster.local:5432/${var.graph_db_name}?sslmode=require"
  sensitive   = true
}
