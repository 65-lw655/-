use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeviceSettings {
    pub device_id: Uuid,
    pub next_client_sequence: i64,
}
