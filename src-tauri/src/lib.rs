pub mod build;
pub mod coordinator;
pub mod diagnostics;
pub mod harness;
pub mod paste;
pub mod placement;
pub mod process;
pub mod response;
pub mod settings;
pub mod templates;

#[cfg(feature = "desktop")]
mod desktop;
#[cfg(feature = "desktop")]
mod desktop_platform;
#[cfg(feature = "desktop")]
pub use desktop::run;
