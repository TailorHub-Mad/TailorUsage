use bytes::Bytes;
use http_body_util::Full;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::proxy::types::Provider;
use crate::proxy::upstream;

async fn handle_request(
    provider: Provider,
    local_addr: SocketAddr,
    peer_addr: SocketAddr,
    req: Request<hyper::body::Incoming>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    upstream::forward(provider, local_addr, peer_addr, req).await
}

/// Start a proxy listener on the given port for the given provider.
/// Returns when the shutdown signal is received.
pub async fn run_listener(
    provider: Provider,
    port: u16,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await?;

    log::info!(
        "Proxy listener started: {:?} on 127.0.0.1:{}",
        provider,
        port
    );

    loop {
        tokio::select! {
            result = listener.accept() => {
                let (stream, _) = result?;
                let local_addr = stream.local_addr()?;
                let peer_addr = stream.peer_addr()?;
                let io = TokioIo::new(stream);

                tokio::spawn(async move {
                    let svc = service_fn(move |req| handle_request(provider, local_addr, peer_addr, req));
                    if let Err(e) = http1::Builder::new()
                        .serve_connection(io, svc)
                        .with_upgrades()
                        .await
                    {
                        if !e.to_string().contains("connection closed") {
                            log::error!("Proxy connection error ({:?}): {}", provider, e);
                        }
                    }
                });
            }
            _ = shutdown_rx.changed() => {
                log::info!("Proxy listener shutting down: {:?} on port {}", provider, port);
                break;
            }
        }
    }

    Ok(())
}

/// Check if a port is available for binding.
pub fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).is_ok()
}
