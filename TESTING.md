# FortiX Testing & Verification

## The Golden Demo (`run-golden-demo.js`)

FortiX utilizes a deterministic, end-to-end integration sequence known as the **Golden Demo**. This script executes a complete operational lifecycle against the live system, persisting real telemetry and validating expected security behaviors.

### Execution Lifecycle
1. **Provisioning**: Authenticates, creates a Project, registers an Upstream API, and generates an API Key.
2. **Policy Definition**: Establishes a Token Bucket rate limit of 20 requests per minute.
3. **Traffic Simulation**:
   - Executes valid traffic.
   - Executes unauthorized traffic (Invalid Key).
   - Executes malicious traffic (Path Traversal).
4. **Resilience Testing**: Triggers a 25-request burst to explicitly trigger 429 Rate Limits.
5. **Chaos Engineering**: Enqueues an 800ms Latency Experiment via BullMQ.
6. **Verification**: Mathematically verifies observed telemetry against the defined policy.
7. **Evidence Output**: Generates `fortix-evidence.pdf`.

### Running the Test
\`\`\`bash
node run-golden-demo.js
\`\`\`
Check the root directory for `fortix-evidence.pdf` upon completion.
