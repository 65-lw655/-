use project_online_desktop_lib::commands::credential::{
    credential_status_from_store, delete_credential_from_store, read_credential_from_store,
    save_credential_to_store,
};
use project_online_desktop_lib::credential::memory::MemoryCredentialStore;
use project_online_desktop_lib::credential::{CredentialError, CredentialStatus};
use uuid::Uuid;

#[test]
fn credential_commands_save_read_and_delete_session_secret() {
    let store = MemoryCredentialStore::default();
    let secret = format!("fictional-session-{}", Uuid::new_v4());

    assert_eq!(
        credential_status_from_store(&store).expect("read initial status"),
        CredentialStatus::Missing
    );

    save_credential_to_store(&store, secret.clone()).expect("save credential");

    assert_eq!(
        credential_status_from_store(&store).expect("read saved status"),
        CredentialStatus::Present
    );
    assert_eq!(
        read_credential_from_store(&store).expect("read credential"),
        Some(secret)
    );

    delete_credential_from_store(&store).expect("delete credential");

    assert_eq!(
        credential_status_from_store(&store).expect("read deleted status"),
        CredentialStatus::Missing
    );
    assert_eq!(
        read_credential_from_store(&store).expect("read deleted credential"),
        None
    );
}

#[test]
fn credential_errors_and_debug_output_do_not_expose_secret_values() {
    let secret = format!("fictional-session-{}", Uuid::new_v4());
    let store = MemoryCredentialStore::unavailable();

    let error = save_credential_to_store(&store, secret.clone()).expect_err("save fails safely");
    let debug_output = format!("{error:?}");
    let command_error = project_online_desktop_lib::commands::CommandError::from(error);

    assert_eq!(command_error.code, "CREDENTIAL_UNAVAILABLE");
    assert_eq!(
        command_error.message,
        "desktop credential store is unavailable"
    );
    assert!(!debug_output.contains(&secret));
    assert!(!command_error.message.contains(&secret));

    let not_found = CredentialError::Missing;
    let debug_output = format!("{not_found:?}");

    assert!(!debug_output.contains(&secret));
}
