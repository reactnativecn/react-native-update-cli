#!/usr/bin/env node

// Dedicated entry for the `cresc` bin so brand detection does not depend on
// process.argv[1], which on Windows npm shims always points to the js file
// instead of the invoked command name.
process.env.RNU_BRAND = 'cresc';

require('./bin');
