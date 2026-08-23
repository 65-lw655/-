use serde_json::Value;

#[test]
fn default_capability_excludes_forbidden_integrations() {
    let content =
        std::fs::read_to_string("capabilities/default.json").expect("capability file should exist");
    let serialized = serde_json::from_str::<Value>(&content)
        .expect("capability file should be valid json")
        .to_string()
        .to_lowercase();

    for forbidden in ["shell", "sql", "calendar", "reminder", "todo", "microsoft", "task"] {
        assert!(
            !serialized.contains(forbidden),
            "capability file must not include forbidden permission: {forbidden}"
        );
    }
}
