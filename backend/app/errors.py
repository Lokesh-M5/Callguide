class RepositoryError(Exception):
    """A storage operation failed without committing a false success."""


class DatabaseUnavailable(RepositoryError):
    pass


class CallNotFound(RepositoryError):
    pass


class CallConflict(RepositoryError):
    pass


class AIConfigurationError(Exception):
    pass


class AIProviderError(Exception):
    pass


class AIRateLimitError(Exception):
    pass


class AITimeoutError(Exception):
    pass


class AIOutputError(Exception):
    pass
