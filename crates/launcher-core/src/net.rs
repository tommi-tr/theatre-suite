use crate::Result;
use std::time::Duration;

/// Downloads a small text file (an update list). Used only when the user allowed it.
pub fn fetch_text(url: &str, max_bytes: u64) -> Result<String> {
    if !url.starts_with("https://") {
        return Err("Only https addresses are allowed".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(15))).build().into();
    let mut resp = agent
        .get(url)
        .header("User-Agent", "TheatreSuite-Launcher")
        .header("Accept", "application/json")
        .call()
        .map_err(|e| match e {
            // The interface turns this code into a sentence (the usual cause is a private repository).
            ureq::Error::StatusCode(404) => "NOT_FOUND".to_string(),
            ureq::Error::StatusCode(c) => format!("The server answered with error {c}"),
            other => format!("Cannot reach the server: {other}"),
        })?;
    resp.body_mut().with_config().limit(max_bytes).read_to_string().map_err(|e| format!("Cannot read the answer: {e}"))
}
