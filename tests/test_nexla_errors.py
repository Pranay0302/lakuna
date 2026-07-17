from ingestion.nexla.errors import (
    NexlaError,
    NexlaInputError,
    NexlaConfigError,
    NexlaAuthError,
    NexlaNotFoundError,
    NexlaUpstreamError,
    NexlaCliNotInstalled,
    error_from_exit_code,
)


def test_each_exception_carries_its_exit_code():
    assert NexlaError("x").exit_code == 1
    assert NexlaInputError("x").exit_code == 2
    assert NexlaConfigError("x").exit_code == 3
    assert NexlaAuthError("x").exit_code == 4
    assert NexlaNotFoundError("x").exit_code == 5
    assert NexlaUpstreamError("x").exit_code == 6


def test_cli_not_installed_is_a_config_error():
    err = NexlaCliNotInstalled("missing")
    assert isinstance(err, NexlaConfigError)
    assert err.exit_code == 3


def test_error_from_exit_code_maps_known_codes():
    assert isinstance(error_from_exit_code(4, "forbidden"), NexlaAuthError)
    assert isinstance(error_from_exit_code(5, "gone"), NexlaNotFoundError)
    assert isinstance(error_from_exit_code(6, "boom"), NexlaUpstreamError)


def test_error_from_exit_code_unknown_defaults_to_base():
    err = error_from_exit_code(1, "generic")
    assert type(err) is NexlaError
    assert err.exit_code == 1
    assert str(err) == "generic"
