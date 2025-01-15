class MultipleErrors extends Error {
    constructor(errors) {
        super("Multiple errors occurred");
        this.errors = errors;
    }
}

module.exports = { MultipleErrors };