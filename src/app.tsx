import React, { useState, useEffect, useCallback } from "react";
import cockpit from "cockpit";
import {
    Alert,
    Button,
    Card,
    CardBody,
    CardTitle,
    Checkbox,
    Form,
    FormGroup,
    Grid,
    GridItem,
    Modal,
    ModalVariant,
    Page,
    PageSection,
    PageSectionVariants,
    Spinner,
    Tab,
    Tabs,
    TabTitleText,
    TextInput,
    Title,
    EmptyState,
    EmptyStateBody,
    Content,
    FormHelperText,
    HelperText,
    HelperTextItem,
} from "@patternfly/react-core";
import {
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    ActionsColumn,
    IAction,
} from "@patternfly/react-table";
import { CubesIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";

// Type definitions (keeping existing ones)
interface UserData {
    shell_access: boolean;
    groups: string[];
    created: string;
    dataset?: {
        name: string;
        quota?: string;
        pool: string;
    };
}

interface GroupData {
    description?: string;
    members: string[];
    created: string;
}

interface ShareData {
    dataset: {
        name: string;
        quota?: string;
        pool: string;
    };
    smb_config: {
        comment?: string;
        browseable: boolean;
        read_only: boolean;
        valid_users?: string;
    };
    system: {
        owner: string;
        group: string;
        permissions: string;
    };
    created: string;
}

interface State {
    initialized: boolean;
    primary_pool?: string;
    secondary_pools?: string[];
    server_name?: string;
    workgroup?: string;
    macos_optimized?: boolean;
    default_home_quota?: string;
    users?: Record<string, UserData>;
    groups?: Record<string, GroupData>;
    shares?: Record<string, ShareData>;
}

// API Wrapper for smb-zfs commands (keeping existing)
const smbZfsApi = {
    getState: (): Promise<State> =>
        cockpit.spawn(["smb-zfs", "get-state", "--json"])
            .then(output => {
                if (!output) return {} as any;
                try {
                    return JSON.parse(output);
                } catch {
                    if (output.toLowerCase().startsWith("error:")) {
                        throw new Error(output);
                    }
                    throw new Error("Failed to parse state JSON");
                }
            }),

    listPools: (): Promise<string[]> =>
        cockpit.spawn(["smb-zfs", "list", "pools", "--json"])
            .then(output => {
                if (!output) return [];
                try {
                    return JSON.parse(output);
                } catch {
                    if (output.toLowerCase().startsWith("error:")) {
                        throw new Error(output);
                    }
                    throw new Error("Failed to parse pools JSON");
                }
            }),

    run: (command: string[]): Promise<unknown> => {
        const mutating = ["create", "modify", "delete", "passwd"].includes(command[0]);
        return cockpit
            .spawn(["smb-zfs", ...command, "--json"], mutating ? { superuser: "require" } : undefined)
            .then(output => {
                if (!output) return null;
                try {
                    const result = JSON.parse(output);
                    if ((result as any)?.error) {
                        throw new Error((result as any).error);
                    }
                    return result;
                } catch {
                    if (output.toLowerCase().startsWith("error:")) {
                        throw new Error(output);
                    }
                    // If output is plain text but not an "error:" line, return it for callers that expect strings
                    return output;
                }
            });
    }
};

// Main Application Component (keeping existing structure)
const App = () => {
    const [state, setState] = useState<State | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isRoot, setIsRoot] = useState(false);
    const [currentUser, setCurrentUser] = useState("");
    const [activeTabKey, setActiveTabKey] = useState<string | number>(0);

    const refreshState = useCallback(() => {
        setLoading(true);
        smbZfsApi.getState()
            .then((data: any) => {
                const normalized: State = {
                    initialized: Boolean(data?.initialized),
                    primary_pool: data?.primary_pool || "",
                    secondary_pools: Array.isArray(data?.secondary_pools) ? data.secondary_pools : [],
                    server_name: data?.server_name || "",
                    workgroup: data?.workgroup || "",
                    macos_optimized: Boolean(data?.macos_optimized),
                    default_home_quota: data?.default_home_quota || "",
                    users: data?.users || {},
                    groups: data?.groups || {},
                    shares: data?.shares || {},
                };
                setState(normalized);
                setError(null);
            })
            .catch(err => {
                if ((err?.message || "").includes("not initialized")) {
                    setState({ initialized: false, secondary_pools: [], users: {}, groups: {}, shares: {} });
                    setError(null);
                } else {
                    setError(err?.message || String(err));
                }
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const permission = cockpit.permission();
        const onChanged = () => {
            setIsRoot(permission.is_superuser || false);
        };
        permission.addEventListener("changed", onChanged);
        setIsRoot(permission.is_superuser || false);
        setCurrentUser(cockpit.user?.name || "unknown");
        refreshState();
        return () => {
            try {
                permission.removeEventListener("changed", onChanged);
            } catch {
                // older cockpit may not support removeEventListener; ignore
            }
        };
    }, [refreshState]);

    const handleTabClick = (_event: React.MouseEvent, tabIndex: string | number) => {
        setActiveTabKey(tabIndex);
    };

    if (loading) {
        return <Page><PageSection variant={PageSectionVariants.light}><Spinner /></PageSection></Page>;
    }

    if (error) {
        return (
            <Page>
                <PageSection>
                    <Alert
                        variant="danger"
                        title="Error Loading Plugin"
                        actionClose={{ title: 'Close', onClose: () => setError(null) }}
                        actionLinks={
                            <Button variant="primary" onClick={refreshState}>Retry</Button>
                        }
                    >
                        {error}
                    </Alert>
                </PageSection>
            </Page>
        );
    }

    if (!state) {
        return (
            <Page>
                <PageSection>
                    <EmptyState>
                        <CubesIcon size="xl" />
                        <Title headingLevel="h4" size="lg">No Data</Title>
                        <EmptyStateBody>Could not retrieve data from smb-zfs.</EmptyStateBody>
                    </EmptyState>
                </PageSection>
            </Page>
        );
    }

    if (!state.initialized) {
        return <InitialSetup onSetupComplete={refreshState} />;
    }

    const tabs = [
        <Tab key="overview" eventKey={0} title={<TabTitleText>Overview</TabTitleText>}>
            <OverviewTab state={state} onRefresh={refreshState} />
        </Tab>
    ];

    if (isRoot) {
        tabs.push(
            <Tab key="users" eventKey={1} title={<TabTitleText>Users</TabTitleText>}>
                <UsersTab users={state.users || {}} onRefresh={refreshState} />
            </Tab>,
            <Tab key="groups" eventKey={2} title={<TabTitleText>Groups</TabTitleText>}>
                <GroupsTab groups={state.groups || {}} users={Object.keys(state.users || {})} onRefresh={refreshState} />
            </Tab>,
            <Tab key="shares" eventKey={3} title={<TabTitleText>Shares</TabTitleText>}>
                <SharesTab shares={state.shares || {}} pools={[...(state.secondary_pools || []), state.primary_pool].filter(Boolean) as string[]} onRefresh={refreshState} />
            </Tab>
        );
    } else {
        tabs.push(
            <Tab key="password" eventKey={1} title={<TabTitleText>Password</TabTitleText>}>
                <PasswordTab user={currentUser} onRefresh={refreshState} />
            </Tab>
        );
    }

    return (
        <Page>
            <PageSection variant={PageSectionVariants.light}>
                <Title headingLevel="h1">Samba on ZFS Management</Title>
                <Content>
                    <p>A tool to manage Samba on a ZFS-backed system.</p>
                </Content>
            </PageSection>
            <PageSection type="tabs">
                <Tabs activeKey={activeTabKey} onSelect={handleTabClick}>
                    {tabs}
                </Tabs>
            </PageSection>
        </Page>
    );
};

export default App;

// #region Initial Setup - Updated with validation
interface InitialSetupProps {
    onSetupComplete: () => void;
}

const InitialSetup: React.FC<InitialSetupProps> = ({ onSetupComplete }) => {
    const primaryPool = useValidation('', (value) => value ? { isValid: true } : { isValid: false, error: 'Primary pool is required' });
    const secondaryPools = useValidation('', (value) => ({ isValid: true }));
    const serverName = useValidation(cockpit.host, (value) => validateName(value, 'server_name'));
    const workgroup = useValidation('WORKGROUP', (value) => validateName(value, 'workgroup'));
    const defaultHomeQuota = useValidation('', validateQuota);

    const [macos, setMacos] = useState(false);
    const [pools, setPools] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        smbZfsApi.listPools().then(setPools).catch(() => setPools([]));
    }, []);

    const isFormValid = () => {
        return primaryPool.isValid &&
               serverName.isValid &&
               workgroup.isValid &&
               defaultHomeQuota.isValid &&
               primaryPool.value;
    };

    const handleSubmit = () => {
        // Validate all fields
        primaryPool.handleBlur();
        serverName.handleBlur();
        workgroup.handleBlur();
        defaultHomeQuota.handleBlur();

        if (!isFormValid()) return;

        setLoading(true);
        setError(null);
        const command = ['setup', '--primary-pool', primaryPool.value];
        if (secondaryPools.value) command.push('--secondary-pools', ...secondaryPools.value.split(' '));
        if (serverName.value) command.push('--server-name', serverName.value);
        if (workgroup.value) command.push('--workgroup', workgroup.value);
        if (macos) command.push('--macos');
        if (defaultHomeQuota.value) command.push('--default-home-quota', defaultHomeQuota.value);

        smbZfsApi.run(command)
            .then(() => onSetupComplete())
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Page>
            <PageSection variant="light">
                <Title headingLevel="h1">Initial Samba-ZFS Setup</Title>
                <p>This system has not been configured yet. Please provide the initial setup parameters.</p>
            </PageSection>
            <PageSection>
                <Card>
                    <CardBody>
                        {error && <Alert variant="danger" title="Setup Failed">{error}</Alert>}
                        <Form>
                            <FormGroup label="Primary ZFS Pool" isRequired fieldId="primary-pool">
                                <p>Select the ZFS pool for user home directories.</p>
                                {pools.length > 0 ? (
                                    <select
                                        className="pf-v5-c-form-control"
                                        value={primaryPool.value}
                                        onChange={(e) => primaryPool.handleChange(e.target.value)}
                                        onBlur={() => primaryPool.handleBlur()}
                                    >
                                        <option value="">Select a pool</option>
                                        {pools.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                ) : (
                                    <TextInput
                                        isRequired
                                        type="text"
                                        id="primary-pool"
                                        value={primaryPool.value}
                                        onChange={(_event, value) => primaryPool.handleChange(value)}
                                        onBlur={() => primaryPool.handleBlur()}
                                        validated={primaryPool.error ? 'error' : 'default'}
                                    />
                                )}
                                {primaryPool.error && (
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                                {primaryPool.error}
                                            </HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                )}
                            </FormGroup>

                            <FormGroup label="Secondary ZFS Pools" fieldId="secondary-pools">
                                <p>Space-separated list of other ZFS pools for shares.</p>
                                <TextInput
                                    type="text"
                                    id="secondary-pools"
                                    value={secondaryPools.value}
                                    onChange={(_event, value) => secondaryPools.handleChange(value)}
                                />
                            </FormGroup>

                            <FormGroup label="Server Name" fieldId="server-name">
                                <TextInput
                                    type="text"
                                    id="server-name"
                                    value={serverName.value}
                                    onChange={(_event, value) => serverName.handleChange(value)}
                                    onBlur={() => serverName.handleBlur()}
                                    validated={serverName.error ? 'error' : 'default'}
                                />
                                {serverName.error && (
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                                {serverName.error}
                                            </HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                )}
                            </FormGroup>

                            <FormGroup label="Workgroup" fieldId="workgroup">
                                <TextInput
                                    type="text"
                                    id="workgroup"
                                    value={workgroup.value}
                                    onChange={(_event, value) => workgroup.handleChange(value)}
                                    onBlur={() => workgroup.handleBlur()}
                                    validated={workgroup.error ? 'error' : 'default'}
                                />
                                {workgroup.error && (
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                                {workgroup.error}
                                            </HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                )}
                            </FormGroup>

                            <FormGroup label="Default Home Quota" fieldId="default-home-quota">
                                <p>Set a default quota for user home directories (e.g., 10G).</p>
                                <TextInput
                                    type="text"
                                    id="default-home-quota"
                                    value={defaultHomeQuota.value}
                                    onChange={(_event, value) => defaultHomeQuota.handleChange(value)}
                                    onBlur={() => defaultHomeQuota.handleBlur()}
                                    validated={defaultHomeQuota.error ? 'error' : 'default'}
                                />
                                {defaultHomeQuota.error && (
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                                {defaultHomeQuota.error}
                                            </HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                )}
                            </FormGroup>

                            <FormGroup fieldId="macos-compat">
                                <Checkbox
                                    label="Enable macOS compatibility optimizations"
                                    id="macos"
                                    isChecked={macos}
                                    onChange={(_event, checked) => setMacos(checked)}
                                />
                            </FormGroup>

                            <Button
                                variant="primary"
                                onClick={handleSubmit}
                                isDisabled={loading || !isFormValid()}
                            >
                                {loading ? <Spinner size="sm" /> : 'Run Setup'}
                            </Button>
                        </Form>
                    </CardBody>
                </Card>
            </PageSection>
        </Page>
    );
};

// #region Overview Tab (keeping existing)
interface OverviewTabProps {
    state: State;
    onRefresh: () => void;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ state, onRefresh }) => (
    <PageSection>
        <Grid hasGutter>
            <GridItem span={12}>
                <Card>
                    <CardTitle>Configuration</CardTitle>
                    <CardBody>
                        <Grid>
                            <GridItem span={6}><strong>Primary Pool:</strong> {state.primary_pool}</GridItem>
                            <GridItem span={6}><strong>Secondary Pools:</strong> {state.secondary_pools?.join(', ') || 'None'}</GridItem>
                            <GridItem span={6}><strong>Server Name:</strong> {state.server_name}</GridItem>
                            <GridItem span={6}><strong>Workgroup:</strong> {state.workgroup}</GridItem>
                            <GridItem span={6}><strong>macOS Optimized:</strong> {state.macos_optimized ? 'Yes' : 'No'}</GridItem>
                            <GridItem span={6}><strong>Default Home Quota:</strong> {state.default_home_quota || 'None'}</GridItem>
                        </Grid>
                    </CardBody>
                </Card>
            </GridItem>
            <GridItem span={12}>
                <Title headingLevel="h2">Users ({Object.keys(state.users || {}).length})</Title>
                <UsersTable users={state.users || {}} isReadOnly />
            </GridItem>
            <GridItem span={12}>
                <Title headingLevel="h2">Groups ({Object.keys(state.groups || {}).length})</Title>
                <GroupsTable groups={state.groups || {}} isReadOnly />
            </GridItem>
            <GridItem span={12}>
                <Title headingLevel="h2">Shares ({Object.keys(state.shares || {}).length})</Title>
                <SharesTable shares={state.shares || {}} isReadOnly />
            </GridItem>
        </Grid>
    </PageSection>
);

// #region Common Components (Tables, Modals)
interface DeleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    item: string;
    type: string;
    loading?: boolean;
    error?: string | null;
}

const DeleteModal: React.FC<DeleteModalProps> = ({ isOpen, onClose, onConfirm, item, type, loading, error }) => (
    <Modal
        variant={ModalVariant.small}
        title={`Delete ${type}`}
        isOpen={isOpen}
        onClose={onClose}
        actions={[
            <Button key="confirm" variant="danger" onClick={onConfirm} isDisabled={loading}>
                {loading ? <Spinner size="sm" /> : 'Delete'}
            </Button>,
            <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
        ]}
    >
        {error && <Alert variant="danger" title={`Failed to delete ${type}`}>{error}</Alert>}
        Are you sure you want to delete the {type} <strong>{item}</strong>? This action cannot be undone.
    </Modal>
);

// #region Users - Updated with validation
interface UsersTabProps {
    users: Record<string, UserData>;
    onRefresh: () => void;
}

const UsersTab: React.FC<UsersTabProps> = ({ users, onRefresh }) => {
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isModifyModalOpen, setModifyModalOpen] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<string | null>(null);

    const handleAction = (action: string, user: string) => {
        setSelectedUser(user);
        if (action === 'modify') setModifyModalOpen(true);
        if (action === 'delete') setDeleteModalOpen(true);
        if (action === 'password') setPasswordModalOpen(true);
    };

    return (
        <PageSection>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: '1rem' }}>
                <Button variant="primary" onClick={() => setCreateModalOpen(true)}>Create User</Button>
            </div>
            <UsersTable users={users} onAction={handleAction} />

            <CreateUserModal isOpen={isCreateModalOpen} onClose={() => setCreateModalOpen(false)} onSave={onRefresh} />
            {selectedUser && <>
                <ModifyUserModal
                    isOpen={isModifyModalOpen}
                    onClose={() => setModifyModalOpen(false)}
                    onSave={onRefresh}
                    user={selectedUser}
                    userData={users[selectedUser]}
                />
                <DeleteUserModal
                    isOpen={isDeleteModalOpen}
                    onClose={() => setDeleteModalOpen(false)}
                    onSave={onRefresh}
                    user={selectedUser}
                />
                <ChangePasswordModal
                    isOpen={isPasswordModalOpen}
                    onClose={() => setPasswordModalOpen(false)}
                    onSave={onRefresh}
                    user={selectedUser}
                />
            </>}
        </PageSection>
    );
};

interface UsersTableProps {
    users: Record<string, UserData>;
    onAction?: (action: string, user: string) => void;
    isReadOnly?: boolean;
}

const UsersTable: React.FC<UsersTableProps> = ({ users, onAction, isReadOnly = false }) => {
    const columns = ['Username', 'Shell Access', 'Groups', 'Quota', 'Created'];
    if (!isReadOnly) columns.push('');

    const rows = Object.entries(users).map(([name, data]) => ({
        name,
        cells: [
            name,
            data.shell_access ? 'Yes' : 'No',
            data.groups.join(', ') || '-',
            data.dataset?.quota || 'Default',
            new Date(data.created).toLocaleString()
        ]
    }));

    const actions = (user: string): IAction[] => [
        { title: 'Modify Home Quota', onClick: () => onAction?.('modify', user) },
        { title: 'Change Password', onClick: () => onAction?.('password', user) },
        { isSeparator: true },
        { title: 'Delete User', onClick: () => onAction?.('delete', user) },
    ];

    return (
        <Table aria-label="Users Table">
            <Thead>
                <Tr>
                    {columns.map((col, i) => <Th key={i}>{col}</Th>)}
                </Tr>
            </Thead>
            <Tbody>
                {rows.map(row => (
                    <Tr key={row.name}>
                        {row.cells.map((cell, i) => (
                            <Td key={`${row.name}-${i}`} dataLabel={columns[i]}>{cell}</Td>
                        ))}
                        {!isReadOnly && onAction && (
                            <Td isActionCell>
                                <ActionsColumn items={actions(row.name)} />
                            </Td>
                        )}
                    </Tr>
                ))}
            </Tbody>
        </Table>
    );
};

interface CreateUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
}

const CreateUserModal: React.FC<CreateUserModalProps> = ({ isOpen, onClose, onSave }) => {
    const userName = useValidation('', (value) => validateName(value, 'user'));
    const password = useValidation('', validatePassword);
    const groups = useValidation('', validateUserList);

    const [shell, setShell] = useState(false);
    const [noHome, setNoHome] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isFormValid = () => {
        return userName.isValid && password.isValid && groups.isValid && userName.value;
    };

    const handleSave = () => {
        // Validate all fields before submitting
        userName.handleBlur();
        password.handleBlur();
        groups.handleBlur();

        if (!isFormValid()) return;

        setLoading(true);
        setError(null);
        const command = ['create', 'user', userName.value];
        if (password.value) command.push('--password', password.value);
        if (shell) command.push('--shell');
        if (groups.value) command.push('--groups', groups.value);
        if (noHome) command.push('--no-home');

        smbZfsApi.run(command)
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.medium}
            title="Create New User"
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading || !isFormValid()}>
                    {loading ? <Spinner size="sm" /> : 'Save'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to create user">{error}</Alert>}
            <Form>
                <FormGroup label="Username" isRequired fieldId="user-name">
                    <TextInput
                        isRequired
                        type="text"
                        id="user-name"
                        value={userName.value}
                        onChange={(_event, value) => userName.handleChange(value)}
                        onBlur={() => userName.handleBlur()}
                        validated={userName.error ? 'error' : 'default'}
                    />
                    {userName.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {userName.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup label="Password" fieldId="user-password">
                    <TextInput
                        type="password"
                        id="user-password"
                        value={password.value}
                        onChange={(_event, value) => password.handleChange(value)}
                        onBlur={() => password.handleBlur()}
                        validated={password.error ? 'error' : 'default'}
                    />
                    {password.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {password.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup label="Groups" fieldId="user-groups">
                    <TextInput
                        type="text"
                        id="user-groups"
                        placeholder="comma-separated"
                        value={groups.value}
                        onChange={(_event, value) => groups.handleChange(value)}
                        onBlur={() => groups.handleBlur()}
                        validated={groups.error ? 'error' : 'default'}
                    />
                    {groups.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {groups.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup fieldId="user-options">
                    <Checkbox
                        label="Grant standard shell access"
                        id="user-shell"
                        isChecked={shell}
                        onChange={(_event, checked) => setShell(checked)}
                    />
                    <Checkbox
                        label="Do not create a home directory"
                        id="user-no-home"
                        isChecked={noHome}
                        onChange={(_event, checked) => setNoHome(checked)}
                    />
                </FormGroup>
            </Form>
        </Modal>
    );
};

interface ModifyUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    user: string;
    userData: UserData;
}

const ModifyUserModal: React.FC<ModifyUserModalProps> = ({ isOpen, onClose, onSave, user, userData }) => {
    const quota = useValidation(userData?.dataset?.quota || '', validateQuota);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        quota.handleBlur();
        if (!quota.isValid) return;

        setLoading(true);
        setError(null);
        smbZfsApi.run(['modify', 'home', user, '--quota', quota.value || 'none'])
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.medium}
            title={`Modify Home Quota for ${user}`}
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading || !quota.isValid}>
                    {loading ? <Spinner size="sm" /> : 'Save'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to modify quota">{error}</Alert>}
            <Form>
                <FormGroup
                    label="New Quota"
                    helperText="e.g., 20G. Leave empty or use 'none' to remove."
                    fieldId="user-quota"
                >
                    <TextInput
                        type="text"
                        id="user-quota"
                        value={quota.value}
                        onChange={(_event, value) => quota.handleChange(value)}
                        onBlur={() => quota.handleBlur()}
                        validated={quota.error ? 'error' : 'default'}
                    />
                    {quota.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {quota.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>
            </Form>
        </Modal>
    );
};

interface DeleteUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    user: string;
}

const DeleteUserModal: React.FC<DeleteUserModalProps> = ({ isOpen, onClose, onSave, user }) => {
    const [deleteData, setDeleteData] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirm = () => {
        setLoading(true);
        setError(null);
        const command = ['delete', 'user', user, '--yes'];
        if (deleteData) command.push('--delete-data');

        smbZfsApi.run(command)
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.small}
            title={`Delete User ${user}`}
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button key="confirm" variant="danger" onClick={handleConfirm} isDisabled={loading}>
                    {loading ? <Spinner size="sm" /> : 'Delete'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to delete user">{error}</Alert>}
            <p>Are you sure you want to delete user <strong>{user}</strong>?</p>
            <Checkbox
                label="Permanently delete the user's ZFS home directory."
                id={`delete-data-user-${user}`}
                isChecked={deleteData}
                onChange={(_event, checked) => setDeleteData(checked)}
            />
        </Modal>
    );
};

interface ChangePasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    user: string;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose, onSave, user }) => {
    const password = useValidation('', validatePassword);
    const confirm = useValidation('', (value) => validatePassword(value, password.value));

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isFormValid = () => {
        return password.isValid && confirm.isValid && password.value && password.value === confirm.value;
    };

    const handleSave = () => {
        password.handleBlur();
        confirm.handleBlur();

        if (!isFormValid()) return;

        setLoading(true);
        setError(null);
        const proc = cockpit.spawn(["smb-zfs", "passwd", user, "--json"], { superuser: "require" });
        proc.input(password.value + "\n" + password.value + "\n", true);
        proc.stream((output: string) => console.log(output))
           .then(() => { onSave(); onClose(); })
           .catch((err: any) => setError(err.message || "Failed to change password."))
           .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.medium}
            title={`Change Password for ${user}`}
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button
                    key="save"
                    variant="primary"
                    onClick={handleSave}
                    isDisabled={loading || !isFormValid()}
                >
                    Set Password
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Password Change Failed">{error}</Alert>}
            <Form>
                <FormGroup label="New Password" isRequired fieldId="new-password">
                    <TextInput
                        isRequired
                        type="password"
                        id="new-password"
                        value={password.value}
                        onChange={(_event, value) => {
                            password.handleChange(value);
                            // Re-validate confirm password when main password changes
                            if (confirm.touched) {
                                confirm.handleChange(confirm.value);
                            }
                        }}
                        onBlur={() => password.handleBlur()}
                        validated={password.error ? 'error' : 'default'}
                    />
                    {password.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {password.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup label="Confirm New Password" isRequired fieldId="confirm-password">
                    <TextInput
                        isRequired
                        type="password"
                        id="confirm-password"
                        value={confirm.value}
                        onChange={(_event, value) => confirm.handleChange(value)}
                        onBlur={() => confirm.handleBlur()}
                        validated={confirm.error ? 'error' : 'default'}
                    />
                    {confirm.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {confirm.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>
            </Form>
        </Modal>
    );
};

// #region Groups - Updated with validation
interface GroupsTabProps {
    groups: Record<string, GroupData>;
    users: string[];
    onRefresh: () => void;
}

const GroupsTab: React.FC<GroupsTabProps> = ({ groups, users, onRefresh }) => {
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isModifyModalOpen, setModifyModalOpen] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

    const handleAction = (action: string, group: string) => {
        setSelectedGroup(group);
        if (action === 'modify') setModifyModalOpen(true);
        if (action === 'delete') setDeleteModalOpen(true);
    };

    return (
        <PageSection>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: '1rem' }}>
                <Button variant="primary" onClick={() => setCreateModalOpen(true)}>Create Group</Button>
            </div>
            <GroupsTable groups={groups} onAction={handleAction} />

            <CreateGroupModal isOpen={isCreateModalOpen} onClose={() => setCreateModalOpen(false)} onSave={onRefresh} />
            {selectedGroup && <>
                <ModifyGroupModal
                    isOpen={isModifyModalOpen}
                    onClose={() => setModifyModalOpen(false)}
                    onSave={onRefresh}
                    group={selectedGroup}
                    groupData={groups[selectedGroup]}
                    allUsers={users}
                />
                <DeleteModal
                    isOpen={isDeleteModalOpen}
                    onClose={() => setDeleteModalOpen(false)}
                    onConfirm={() => smbZfsApi.run(['delete', 'group', selectedGroup]).then(onRefresh).then(() => setDeleteModalOpen(false))}
                    item={selectedGroup}
                    type="group"
                />
            </>}
        </PageSection>
    );
};

interface GroupsTableProps {
    groups: Record<string, GroupData>;
    onAction?: (action: string, group: string) => void;
    isReadOnly?: boolean;
}

const GroupsTable: React.FC<GroupsTableProps> = ({ groups, onAction, isReadOnly = false }) => {
    const columns = ['Group Name', 'Description', 'Members', 'Created'];
    if (!isReadOnly) columns.push('');

    const rows = Object.entries(groups).map(([name, data]) => ({
        name,
        cells: [
            name,
            data.description || '-',
            data.members.length > 0 ? data.members.join(', ') : 'No members',
            new Date(data.created).toLocaleString()
        ]
    }));

    const actions = (group: string): IAction[] => [
        { title: 'Modify Members', onClick: () => onAction?.('modify', group) },
        { isSeparator: true },
        { title: 'Delete Group', onClick: () => onAction?.('delete', group) },
    ];

    return (
        <Table aria-label="Groups Table">
            <Thead>
                <Tr>
                    {columns.map((col, i) => <Th key={i}>{col}</Th>)}
                </Tr>
            </Thead>
            <Tbody>
                {rows.map(row => (
                    <Tr key={row.name}>
                        {row.cells.map((cell, i) => (
                            <Td key={`${row.name}-${i}`} dataLabel={columns[i]}>{cell}</Td>
                        ))}
                        {!isReadOnly && onAction && (
                            <Td isActionCell>
                                <ActionsColumn items={actions(row.name)} />
                            </Td>
                        )}
                    </Tr>
                ))}
            </Tbody>
        </Table>
    );
};

interface CreateGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ isOpen, onClose, onSave }) => {
    const groupName = useValidation('', (value) => validateName(value, 'group'));
    const description = useValidation('', () => ({ isValid: true })); // Description is always valid
    const users = useValidation('', validateUserList);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isFormValid = () => {
        return groupName.isValid && description.isValid && users.isValid && groupName.value;
    };

    const handleSave = () => {
        groupName.handleBlur();
        users.handleBlur();

        if (!isFormValid()) return;

        setLoading(true);
        setError(null);
        const command = ['create', 'group', groupName.value];
        if (description.value) command.push('--description', description.value);
        if (users.value) command.push('--users', users.value);

        smbZfsApi.run(command)
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.medium}
            title="Create New Group"
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading || !isFormValid()}>
                    {loading ? <Spinner size="sm" /> : 'Save'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to create group">{error}</Alert>}
            <Form>
                <FormGroup label="Group Name" isRequired fieldId="group-name">
                    <TextInput
                        isRequired
                        type="text"
                        id="group-name"
                        value={groupName.value}
                        onChange={(_event, value) => groupName.handleChange(value)}
                        onBlur={() => groupName.handleBlur()}
                        validated={groupName.error ? 'error' : 'default'}
                    />
                    {groupName.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {groupName.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup label="Description" fieldId="group-desc">
                    <TextInput
                        type="text"
                        id="group-desc"
                        value={description.value}
                        onChange={(_event, value) => description.handleChange(value)}
                    />
                </FormGroup>

                <FormGroup label="Initial Members" fieldId="group-users">
                    <TextInput
                        type="text"
                        id="group-users"
                        placeholder="comma-separated"
                        value={users.value}
                        onChange={(_event, value) => users.handleChange(value)}
                        onBlur={() => users.handleBlur()}
                        validated={users.error ? 'error' : 'default'}
                    />
                    {users.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {users.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>
            </Form>
        </Modal>
    );
};

interface ModifyGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    group: string;
    groupData: GroupData;
    allUsers: string[];
}

const ModifyGroupModal: React.FC<ModifyGroupModalProps> = ({ isOpen, onClose, onSave, group, groupData, allUsers }) => {
    const addUsers = useValidation('', validateUserList);
    const removeUsers = useValidation('', validateUserList);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isFormValid = () => {
        return addUsers.isValid && removeUsers.isValid;
    };

    const handleSave = () => {
        addUsers.handleBlur();
        removeUsers.handleBlur();

        if (!isFormValid()) return;

        setLoading(true);
        setError(null);
        const command = ['modify', 'group', group];
        if (addUsers.value) command.push('--add-users', addUsers.value);
        if (removeUsers.value) command.push('--remove-users', removeUsers.value);

        smbZfsApi.run(command)
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.medium}
            title={`Modify Group ${group}`}
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading || !isFormValid()}>
                    {loading ? <Spinner size="sm" /> : 'Save'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to modify group">{error}</Alert>}
            <Form>
                <FormGroup label="Current Members" fieldId="current-members">
                    <Content>
                        <p>{groupData.members.join(', ') || 'None'}</p>
                    </Content>
                </FormGroup>

                <FormGroup label="Add Users" fieldId="add-users">
                    <TextInput
                        type="text"
                        id="add-users"
                        placeholder="comma-separated"
                        value={addUsers.value}
                        onChange={(_event, value) => addUsers.handleChange(value)}
                        onBlur={() => addUsers.handleBlur()}
                        validated={addUsers.error ? 'error' : 'default'}
                    />
                    {addUsers.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {addUsers.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup label="Remove Users" fieldId="remove-users">
                    <TextInput
                        type="text"
                        id="remove-users"
                        placeholder="comma-separated"
                        value={removeUsers.value}
                        onChange={(_event, value) => removeUsers.handleChange(value)}
                        onBlur={() => removeUsers.handleBlur()}
                        validated={removeUsers.error ? 'error' : 'default'}
                    />
                    {removeUsers.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {removeUsers.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>
            </Form>
        </Modal>
    );
};

// #region Shares - Updated with validation
interface SharesTabProps {
    shares: Record<string, ShareData>;
    pools: string[];
    onRefresh: () => void;
}

const SharesTab: React.FC<SharesTabProps> = ({ shares, pools, onRefresh }) => {
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isModifyModalOpen, setModifyModalOpen] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedShare, setSelectedShare] = useState<string | null>(null);

    const handleAction = (action: string, share: string) => {
        setSelectedShare(share);
        if (action === 'modify') setModifyModalOpen(true);
        if (action === 'delete') setDeleteModalOpen(true);
    };

    return (
        <PageSection>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: '1rem' }}>
                <Button variant="primary" onClick={() => setCreateModalOpen(true)}>Create Share</Button>
            </div>
            <SharesTable shares={shares} onAction={handleAction} />

            <CreateShareModal
                isOpen={isCreateModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onSave={onRefresh}
                pools={pools}
            />
            {selectedShare && <>
                <ModifyShareModal
                    isOpen={isModifyModalOpen}
                    onClose={() => setModifyModalOpen(false)}
                    onSave={onRefresh}
                    share={selectedShare}
                    shareData={shares[selectedShare]}
                    pools={pools}
                />
                <DeleteShareModal
                    isOpen={isDeleteModalOpen}
                    onClose={() => setDeleteModalOpen(false)}
                    onSave={onRefresh}
                    share={selectedShare}
                />
            </>}
        </PageSection>
    );
};

interface SharesTableProps {
    shares: Record<string, ShareData>;
    onAction?: (action: string, share: string) => void;
    isReadOnly?: boolean;
}

const SharesTable: React.FC<SharesTableProps> = ({ shares, onAction, isReadOnly = false }) => {
    const columns = ['Share Name', 'Comment', 'Dataset', 'Quota', 'Access', 'Created'];
    if (!isReadOnly) columns.push('');

    const rows = Object.entries(shares).map(([name, data]) => ({
        name,
        cells: [
            name,
            data.smb_config.comment || '-',
            data.dataset.name,
            data.dataset.quota || 'None',
            `${data.smb_config.read_only ? 'RO' : 'RW'}, ${data.smb_config.browseable ? 'Browseable' : 'Hidden'}`,
            new Date(data.created).toLocaleString()
        ]
    }));

    const actions = (share: string): IAction[] => [
        { title: 'Modify Share', onClick: () => onAction?.('modify', share) },
        { isSeparator: true },
        { title: 'Delete Share', onClick: () => onAction?.('delete', share) },
    ];

    return (
        <Table aria-label="Shares Table">
            <Thead>
                <Tr>
                    {columns.map((col, i) => <Th key={i}>{col}</Th>)}
                </Tr>
            </Thead>
            <Tbody>
                {rows.map(row => (
                    <Tr key={row.name}>
                        {row.cells.map((cell, i) => (
                            <Td key={`${row.name}-${i}`} dataLabel={columns[i]}>{cell}</Td>
                        ))}
                        {!isReadOnly && onAction && (
                            <Td isActionCell>
                                <ActionsColumn items={actions(row.name)} />
                            </Td>
                        )}
                    </Tr>
                ))}
            </Tbody>
        </Table>
    );
};

interface CreateShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    pools: string[];
}

const CreateShareModal: React.FC<CreateShareModalProps> = ({ isOpen, onClose, onSave, pools }) => {
    const shareName = useValidation('', (value) => validateName(value, 'share'));
    const dataset = useValidation('', validateDatasetPath);
    const comment = useValidation('', () => ({ isValid: true }));
    const owner = useValidation('root', (value) => validateName(value, 'owner'));
    const group = useValidation('smb_users', (value) => validateName(value, 'group'));
    const permissions = useValidation('775', validatePermissions);
    const validUsers = useValidation('', validateUserList);
    const quota = useValidation('', validateQuota);

    const [pool, setPool] = useState(pools[0] || '');
    const [readonly, setReadonly] = useState(false);
    const [noBrowse, setNoBrowse] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isFormValid = () => {
        return shareName.isValid &&
               dataset.isValid &&
               comment.isValid &&
               owner.isValid &&
               group.isValid &&
               permissions.isValid &&
               validUsers.isValid &&
               quota.isValid &&
               shareName.value &&
               dataset.value;
    };

    const handleSave = () => {
        // Validate all fields
        shareName.handleBlur();
        dataset.handleBlur();
        owner.handleBlur();
        group.handleBlur();
        permissions.handleBlur();
        validUsers.handleBlur();
        quota.handleBlur();

        if (!isFormValid()) return;

        setLoading(true);
        setError(null);
        const command = ['create', 'share', shareName.value, '--dataset', dataset.value];
        if (pool) command.push('--pool', pool);
        if (comment.value) command.push('--comment', comment.value);
        if (owner.value) command.push('--owner', owner.value);
        if (group.value) command.push('--group', group.value);
        if (permissions.value) command.push('--perms', permissions.value);
        if (validUsers.value) command.push('--valid-users', validUsers.value);
        if (readonly) command.push('--readonly');
        if (noBrowse) command.push('--no-browse');
        if (quota.value) command.push('--quota', quota.value);

        smbZfsApi.run(command)
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.large}
            title="Create New Share"
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button
                    key="save"
                    variant="primary"
                    onClick={handleSave}
                    isDisabled={loading || !isFormValid()}
                >
                    {loading ? <Spinner size="sm" /> : 'Save'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to create share">{error}</Alert>}
            <Form>
                <Grid hasGutter>
                    <GridItem span={6}>
                        <FormGroup label="Share Name" isRequired fieldId="share-name">
                            <TextInput
                                isRequired
                                type="text"
                                id="share-name"
                                value={shareName.value}
                                onChange={(_event, value) => shareName.handleChange(value)}
                                onBlur={() => shareName.handleBlur()}
                                validated={shareName.error ? 'error' : 'default'}
                            />
                            {shareName.error && (
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                            {shareName.error}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            )}
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="ZFS Dataset Path" isRequired fieldId="share-dataset">
                            <TextInput
                                isRequired
                                type="text"
                                id="share-dataset"
                                placeholder="e.g., data/projects"
                                value={dataset.value}
                                onChange={(_event, value) => dataset.handleChange(value)}
                                onBlur={() => dataset.handleBlur()}
                                validated={dataset.error ? 'error' : 'default'}
                            />
                            {dataset.error && (
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                            {dataset.error}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            )}
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="ZFS Pool" fieldId="share-pool">
                            <select
                                className="pf-v5-c-form-control"
                                value={pool}
                                onChange={(e) => setPool(e.target.value)}
                            >
                                {pools.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Comment" fieldId="share-comment">
                            <TextInput
                                type="text"
                                id="share-comment"
                                value={comment.value}
                                onChange={(_event, value) => comment.handleChange(value)}
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Owner (user)" fieldId="share-owner">
                            <TextInput
                                type="text"
                                id="share-owner"
                                value={owner.value}
                                onChange={(_event, value) => owner.handleChange(value)}
                                onBlur={() => owner.handleBlur()}
                                validated={owner.error ? 'error' : 'default'}
                            />
                            {owner.error && (
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                            {owner.error}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            )}
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Owner (group)" fieldId="share-group">
                            <TextInput
                                type="text"
                                id="share-group"
                                value={group.value}
                                onChange={(_event, value) => group.handleChange(value)}
                                onBlur={() => group.handleBlur()}
                                validated={group.error ? 'error' : 'default'}
                            />
                            {group.error && (
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                            {group.error}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            )}
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Permissions" fieldId="share-perms">
                            <TextInput
                                type="text"
                                id="share-perms"
                                value={permissions.value}
                                onChange={(_event, value) => permissions.handleChange(value)}
                                onBlur={() => permissions.handleBlur()}
                                validated={permissions.error ? 'error' : 'default'}
                            />
                            {permissions.error && (
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                            {permissions.error}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            )}
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Valid Users/Groups" fieldId="share-valid-users">
                            <TextInput
                                type="text"
                                id="share-valid-users"
                                placeholder="user1,@group1"
                                value={validUsers.value}
                                onChange={(_event, value) => validUsers.handleChange(value)}
                                onBlur={() => validUsers.handleBlur()}
                                validated={validUsers.error ? 'error' : 'default'}
                            />
                            {validUsers.error && (
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                            {validUsers.error}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            )}
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Quota" fieldId="share-quota">
                            <TextInput
                                type="text"
                                id="share-quota"
                                placeholder="e.g., 100G"
                                value={quota.value}
                                onChange={(_event, value) => quota.handleChange(value)}
                                onBlur={() => quota.handleBlur()}
                                validated={quota.error ? 'error' : 'default'}
                            />
                            {quota.error && (
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                            {quota.error}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            )}
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup fieldId="share-options">
                            <Checkbox
                                label="Make share read-only"
                                id="share-readonly"
                                isChecked={readonly}
                                onChange={(_event, checked) => setReadonly(checked)}
                            />
                            <Checkbox
                                label="Hide share from network browse"
                                id="share-no-browse"
                                isChecked={noBrowse}
                                onChange={(_event, checked) => setNoBrowse(checked)}
                            />
                        </FormGroup>
                    </GridItem>
                </Grid>
            </Form>
        </Modal>
    );
};

interface ModifyShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    share: string;
    shareData: ShareData;
    pools: string[];
}

const ModifyShareModal: React.FC<ModifyShareModalProps> = ({ isOpen, onClose, onSave, share, shareData, pools }) => {
    const comment = useValidation(shareData.smb_config.comment || '', () => ({ isValid: true }));
    const quota = useValidation(shareData.dataset.quota || '', validateQuota);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isFormValid = () => {
        return comment.isValid && quota.isValid;
    };

    const handleSave = () => {
        quota.handleBlur();

        if (!isFormValid()) return;

        setLoading(true);
        setError(null);
        const command = ['modify', 'share', share, '--comment', comment.value, '--quota', quota.value || 'none'];

        smbZfsApi.run(command)
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.medium}
            title={`Modify Share ${share}`}
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading || !isFormValid()}>
                    {loading ? <Spinner size="sm" /> : 'Save'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to modify share">{error}</Alert>}
            <Form>
                <FormGroup label="Comment" fieldId="mod-share-comment">
                    <TextInput
                        type="text"
                        id="mod-share-comment"
                        value={comment.value}
                        onChange={(_event, value) => comment.handleChange(value)}
                    />
                </FormGroup>
                <FormGroup label="Quota" fieldId="mod-share-quota">
                    <TextInput
                        type="text"
                        id="mod-share-quota"
                        value={quota.value}
                        onChange={(_event, value) => quota.handleChange(value)}
                        onBlur={() => quota.handleBlur()}
                        validated={quota.error ? 'error' : 'default'}
                    />
                    {quota.error && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error" icon={<ExclamationTriangleIcon />}>
                                    {quota.error}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>
                <Content>
                    <p><small>Note: This is a simplified modification dialog. A full implementation would include all modifiable properties.</small></p>
                </Content>
            </Form>
        </Modal>
    );
};

interface DeleteShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    share: string;
}

const DeleteShareModal: React.FC<DeleteShareModalProps> = ({ isOpen, onClose, onSave, share }) => {
    const [deleteData, setDeleteData] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirm = () => {
        setLoading(true);
        setError(null);
        const command = ['delete', 'share', share, '--yes'];
        if (deleteData) command.push('--delete-data');

        smbZfsApi.run(command)
            .then(() => { onSave(); onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    return (
        <Modal
            variant={ModalVariant.small}
            title={`Delete Share ${share}`}
            isOpen={isOpen}
            onClose={onClose}
            actions={[
                <Button key="confirm" variant="danger" onClick={handleConfirm} isDisabled={loading}>
                    {loading ? <Spinner size="sm" /> : 'Delete'}
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to delete share">{error}</Alert>}
            <p>Are you sure you want to delete share <strong>{share}</strong>?</p>
            <Checkbox
                label="Permanently delete the share's ZFS dataset."
                id={`delete-data-share-${share}`}
                isChecked={deleteData}
                onChange={(_event, checked) => setDeleteData(checked)}
            />
        </Modal>
    );
};

// #region Password Tab (for non-root) - Updated with validation
interface PasswordTabProps {
    user: string;
    onRefresh: () => void;
}

const PasswordTab: React.FC<PasswordTabProps> = ({ user, onRefresh }) => {
    const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
    return (
        <PageSection>
            <Card>
                <CardTitle>Change Your Password</CardTitle>
                <CardBody>
                    <p>You can change your own Samba password here.</p>
                    <Button variant="primary" onClick={() => setPasswordModalOpen(true)}>
                        Change Password
                    </Button>
                </CardBody>
            </Card>
            <ChangePasswordModal
                isOpen={isPasswordModalOpen}
                onClose={() => setPasswordModalOpen(false)}
                onSave={onRefresh}
                user={user}
            />
        </PageSection>
    );
};
// Validation utilities
interface ValidationResult {
    isValid: boolean;
    error?: string;
}

const validateName = (name: string, itemType: string): ValidationResult => {
    if (!name) {
        return { isValid: false, error: `${itemType} name is required.` };
    }

    const itemTypeLower = itemType.toLowerCase();

    if (['user', 'group', 'owner'].includes(itemTypeLower)) {
        if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name)) {
            return {
                isValid: false,
                error: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} name '${name}' is invalid. Must be lowercase, start with letter/underscore, max 32 chars.`
            };
        }
    } else if (itemTypeLower === 'share') {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-:]{0,79}$/.test(name) ||
            name.split(/[._\-:]/).some(component => component === "")) {
            return {
                isValid: false,
                error: `Share name '${name}' is invalid. Must start with letter/number, no empty components, max 80 chars.`
            };
        }
    } else if (['server_name', 'workgroup'].includes(itemTypeLower)) {
        if (!/^(?!-)[A-Za-z0-9-]{1,15}(?<!-)$/.test(name)) {
            return {
                isValid: false,
                error: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} name '${name}' is invalid. 1-15 chars, no leading/trailing hyphens.`
            };
        }
    } else {
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
            return {
                isValid: false,
                error: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} name '${name}' contains invalid characters.`
            };
        }
    }

    return { isValid: true };
};

const validateQuota = (quota: string): ValidationResult => {
    if (!quota) {
        return { isValid: true };
    }
    if (!/^none$|^\d+(?:\.\d+)?[kmgtpez]?$/i.test(quota)) {
        return {
            isValid: false,
            error: "Quota must be 'none' or numeric value with optional unit (e.g., 512M, 120G, 1.5T)"
        };
    }
    return { isValid: true };
};

const validatePassword = (password: string, confirm?: string): ValidationResult => {
    if (!password) {
        return { isValid: false, error: "Password is required." };
    }

    if (confirm !== undefined && password !== confirm) {
        return { isValid: false, error: "Passwords do not match." };
    }

    return { isValid: true };
};

const validatePermissions = (perms: string): ValidationResult => {
    if (!perms) {
        return { isValid: true };
    }

    if (!/^[0-7]{3,4}$/.test(perms)) {
        return {
            isValid: false,
            error: "Permissions must be in octal format (e.g., 755, 644)."
        };
    }

    return { isValid: true };
};

const validateUserList = (users: string): ValidationResult => {
    if (!users) {
        return { isValid: true };
    }

    const userList = users.split(',').map(u => u.trim()).filter(u => u);

    for (const user of userList) {
        const userName = user.startsWith('@') ? user.slice(1) : user;
        const validation = validateName(userName, user.startsWith('@') ? 'group' : 'user');
        if (!validation.isValid) {
            return {
                isValid: false,
                error: `Invalid ${user.startsWith('@') ? 'group' : 'user'} in list: ${validation.error}`
            };
        }
    }

    return { isValid: true };
};

const validateDatasetPath = (path: string): ValidationResult => {
    if (!path) {
        return { isValid: false, error: "Dataset path is required." };
    }
    const re = /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/;
    if (!re.test(path)) {
        return {
            isValid: false,
            error: "Dataset path must be segments of [A-Za-z0-9][A-Za-z0-9_-]* separated by '/', with no leading/trailing '/' or '//'."
        };
    }
    return { isValid: true };
};

// Validation state hook
const useValidation = (initialValue = '', validator: (value: string, ...args: any[]) => ValidationResult) => {
    const [value, setValue] = useState(initialValue);
    const [validation, setValidation] = useState<ValidationResult>({ isValid: true });
    const [touched, setTouched] = useState(false);

    const validateValue = useCallback((newValue: string, ...args: any[]) => {
        const result = validator(newValue, ...args);
        setValidation(result);
        return result;
    }, [validator]);

    const handleChange = useCallback((newValue: string, ...args: any[]) => {
        setValue(newValue);
        setTouched(true);
        return validateValue(newValue, ...args);
    }, [validateValue]);

    const handleBlur = useCallback((...args: any[]) => {
        setTouched(true);
        return validateValue(value, ...args);
    }, [value, validateValue]);

    return {
        value,
        setValue,
        validation,
        touched,
        isValid: validation.isValid,
        error: touched ? validation.error : undefined,
        handleChange,
        handleBlur,
        validate: () => validateValue(value)
    };
};
