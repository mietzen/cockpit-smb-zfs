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
import { CubesIcon } from "@patternfly/react-icons";

// Type definitions
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

// API Wrapper for smb-zfs commands
const smbZfsApi = {
    getState: (): Promise<State> => cockpit.spawn(["smb-zfs", "get-state"]).then(JSON.parse),
    listPools: (): Promise<string[]> => cockpit.spawn(["smb-zfs", "list", "pools", "--json"]).then(JSON.parse),
    run: (command: string[]): Promise<any> => cockpit.spawn(["smb-zfs", ...command, "--json"]).then(output => {
        try {
            const result = JSON.parse(output);
            if (result.error) {
                throw new Error(result.error);
            }
            return result;
        } catch (e) {
            // Handle non-json error output
            if (output.toLowerCase().startsWith("error:")) {
                throw new Error(output);
            }
            throw new Error("An unexpected error occurred: " + output);
        }
    })
};

// Main Application Component
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
            .then(data => {
                setState(data);
                setError(null);
            })
            .catch(err => {
                // If get-state fails, it might mean it's not initialized
                if (err.message.includes("not initialized")) {
                    setState({ initialized: false });
                    setError(null);
                } else {
                    setError(err.message);
                }
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const permission = cockpit.permission();
        permission.addEventListener("changed", () => {
            setIsRoot(permission.is_superuser || false);
        });
        setIsRoot(permission.is_superuser || false);
        setCurrentUser(cockpit.user?.name || "unknown");
        refreshState();
    }, [refreshState]);

    const handleTabClick = (_event: React.MouseEvent, tabIndex: string | number) => {
        setActiveTabKey(tabIndex);
    };

    if (loading) {
        return <Page><PageSection variant={PageSectionVariants.light}><Spinner /></PageSection></Page>;
    }

    if (error) {
        return <Page><PageSection><Alert variant="danger" title="Error Loading Plugin">{error}</Alert></PageSection></Page>;
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

// #region Initial Setup
interface InitialSetupProps {
    onSetupComplete: () => void;
}

const InitialSetup: React.FC<InitialSetupProps> = ({ onSetupComplete }) => {
    const [formData, setFormData] = useState({
        primaryPool: '',
        secondaryPools: '',
        serverName: cockpit.host,
        workgroup: 'WORKGROUP',
        macos: false,
        defaultHomeQuota: '',
    });
    const [pools, setPools] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        smbZfsApi.listPools().then(setPools).catch(() => setPools([]));
    }, []);

    const handleChange = (value: string, event: React.FormEvent<HTMLInputElement>) => {
        const { name, type } = event.currentTarget;
        const checked = (event.currentTarget as HTMLInputElement).checked;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = () => {
        setLoading(true);
        setError(null);
        const command = ['setup', '--primary-pool', formData.primaryPool];
        if (formData.secondaryPools) command.push('--secondary-pools', ...formData.secondaryPools.split(' '));
        if (formData.serverName) command.push('--server-name', formData.serverName);
        if (formData.workgroup) command.push('--workgroup', formData.workgroup);
        if (formData.macos) command.push('--macos');
        if (formData.defaultHomeQuota) command.push('--default-home-quota', formData.defaultHomeQuota);

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
                                        name="primaryPool" 
                                        value={formData.primaryPool} 
                                        onChange={(e) => handleChange(e.target.value, e)}
                                    >
                                        <option value="">Select a pool</option>
                                        {pools.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                ) : (
                                    <TextInput 
                                        isRequired 
                                        type="text" 
                                        id="primary-pool" 
                                        name="primaryPool" 
                                        value={formData.primaryPool} 
                                        onChange={handleChange} 
                                    />
                                )}
                            </FormGroup>
                            <FormGroup label="Secondary ZFS Pools" fieldId="secondary-pools">
                                <p>Space-separated list of other ZFS pools for shares.</p>
                                <TextInput 
                                    type="text" 
                                    id="secondary-pools" 
                                    name="secondaryPools" 
                                    value={formData.secondaryPools} 
                                    onChange={handleChange} 
                                />
                            </FormGroup>
                            <FormGroup label="Server Name" fieldId="server-name">
                                <TextInput 
                                    type="text" 
                                    id="server-name" 
                                    name="serverName" 
                                    value={formData.serverName} 
                                    onChange={handleChange} 
                                />
                            </FormGroup>
                            <FormGroup label="Workgroup" fieldId="workgroup">
                                <TextInput 
                                    type="text" 
                                    id="workgroup" 
                                    name="workgroup" 
                                    value={formData.workgroup} 
                                    onChange={handleChange} 
                                />
                            </FormGroup>
                            <FormGroup label="Default Home Quota" fieldId="default-home-quota">
                                <p>Set a default quota for user home directories (e.g., 10G).</p>
                                <TextInput 
                                    type="text" 
                                    id="default-home-quota" 
                                    name="defaultHomeQuota" 
                                    value={formData.defaultHomeQuota} 
                                    onChange={handleChange} 
                                />
                            </FormGroup>
                            <FormGroup fieldId="macos-compat">
                                <Checkbox 
                                    label="Enable macOS compatibility optimizations" 
                                    id="macos" 
                                    name="macos" 
                                    isChecked={formData.macos} 
                                    onChange={handleChange} 
                                />
                            </FormGroup>
                            <Button 
                                variant="primary" 
                                onClick={handleSubmit} 
                                isDisabled={loading || !formData.primaryPool}
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
// #endregion

// #region Overview Tab
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
// #endregion

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
// #endregion

// #region Users
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
    if (!isReadOnly) columns.push(''); // For actions

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
    const [formData, setFormData] = useState({ 
        user: '', 
        password: '', 
        shell: false, 
        groups: '', 
        noHome: false 
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChange = (value: string, event: React.FormEvent<HTMLInputElement>) => {
        const { name, type } = event.currentTarget;
        const checked = (event.currentTarget as HTMLInputElement).checked;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSave = () => {
        setLoading(true);
        setError(null);
        const command = ['create', 'user', formData.user];
        if (formData.password) command.push('--password', formData.password);
        if (formData.shell) command.push('--shell');
        if (formData.groups) command.push('--groups', formData.groups);
        if (formData.noHome) command.push('--no-home');

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
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading || !formData.user}>
                    Save
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
                        name="user" 
                        value={formData.user} 
                        onChange={handleChange} 
                    />
                </FormGroup>
                <FormGroup label="Password" fieldId="user-password">
                    <TextInput 
                        type="password" 
                        id="user-password" 
                        name="password" 
                        value={formData.password} 
                        onChange={handleChange} 
                    />
                </FormGroup>
                <FormGroup label="Groups" fieldId="user-groups">
                    <TextInput 
                        type="text" 
                        id="user-groups" 
                        name="groups" 
                        placeholder="comma-separated" 
                        value={formData.groups} 
                        onChange={handleChange} 
                    />
                </FormGroup>
                <FormGroup fieldId="user-options">
                    <Checkbox 
                        label="Grant standard shell access" 
                        id="user-shell" 
                        name="shell" 
                        isChecked={formData.shell} 
                        onChange={handleChange} 
                    />
                    <Checkbox 
                        label="Do not create a home directory" 
                        id="user-no-home" 
                        name="noHome" 
                        isChecked={formData.noHome} 
                        onChange={handleChange} 
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
    const [quota, setQuota] = useState(userData?.dataset?.quota || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        setLoading(true);
        setError(null);
        smbZfsApi.run(['modify', 'home', user, '--quota', quota || 'none'])
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
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading}>
                    Save
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
                        name="quota" 
                        value={quota} 
                        onChange={(_event, value) => setQuota(value)} 
                    />
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
                    Delete
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to delete user">{error}</Alert>}
            <p>Are you sure you want to delete user <strong>{user}</strong>?</p>
            <Checkbox 
                label="Permanently delete the user's ZFS home directory." 
                id="delete-data" 
                name="deleteData" 
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
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        if (password !== confirm) {
            setError("Passwords do not match.");
            return;
        }
        setLoading(true);
        setError(null);
        // `passwd` command is interactive, so we pipe the password to it.
        const proc = cockpit.spawn(["smb-zfs", "passwd", user, "--json"], { superuser: "require" });
        proc.input(password + "\n" + password + "\n", true);
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
                    isDisabled={loading || !password || password !== confirm}
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
                        name="password" 
                        value={password} 
                        onChange={(_event, value) => setPassword(value)} 
                    />
                </FormGroup>
                <FormGroup label="Confirm New Password" isRequired fieldId="confirm-password">
                    <TextInput 
                        isRequired 
                        type="password" 
                        id="confirm-password" 
                        name="confirm" 
                        value={confirm} 
                        onChange={(_event, value) => setConfirm(value)} 
                    />
                </FormGroup>
            </Form>
        </Modal>
    );
};
// #endregion

// #region Groups
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
    const [formData, setFormData] = useState({ group: '', description: '', users: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChange = (value: string, event: React.FormEvent<HTMLInputElement>) => {
        const { name } = event.currentTarget;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = () => {
        setLoading(true);
        setError(null);
        const command = ['create', 'group', formData.group];
        if (formData.description) command.push('--description', formData.description);
        if (formData.users) command.push('--users', formData.users);

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
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading || !formData.group}>
                    Save
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
                        name="group" 
                        value={formData.group} 
                        onChange={handleChange} 
                    />
                </FormGroup>
                <FormGroup label="Description" fieldId="group-desc">
                    <TextInput 
                        type="text" 
                        id="group-desc" 
                        name="description" 
                        value={formData.description} 
                        onChange={handleChange} 
                    />
                </FormGroup>
                <FormGroup label="Initial Members" fieldId="group-users">
                    <TextInput 
                        type="text" 
                        id="group-users" 
                        name="users" 
                        placeholder="comma-separated" 
                        value={formData.users} 
                        onChange={handleChange} 
                    />
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
    const [addUsers, setAddUsers] = useState('');
    const [removeUsers, setRemoveUsers] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        setLoading(true);
        setError(null);
        const command = ['modify', 'group', group];
        if (addUsers) command.push('--add-users', addUsers);
        if (removeUsers) command.push('--remove-users', removeUsers);

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
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading}>
                    Save
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
                        name="addUsers" 
                        placeholder="comma-separated" 
                        value={addUsers} 
                        onChange={(_event, value) => setAddUsers(value)} 
                    />
                </FormGroup>
                <FormGroup label="Remove Users" fieldId="remove-users">
                    <TextInput 
                        type="text" 
                        id="remove-users" 
                        name="removeUsers" 
                        placeholder="comma-separated" 
                        value={removeUsers} 
                        onChange={(_event, value) => setRemoveUsers(value)} 
                    />
                </FormGroup>
            </Form>
        </Modal>
    );
};
// #endregion

// #region Shares
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
    const [formData, setFormData] = useState({
        share: '', 
        dataset: '', 
        pool: pools[0] || '', 
        comment: '', 
        owner: 'root',
        group: 'smb_users', 
        perms: '775', 
        validUsers: '', 
        readonly: false, 
        noBrowse: false, 
        quota: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChange = (value: string, event: React.FormEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, type } = event.currentTarget;
        const checked = (event.currentTarget as HTMLInputElement).checked;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSave = () => {
        setLoading(true);
        setError(null);
        const command = ['create', 'share', formData.share, '--dataset', formData.dataset];
        if (formData.pool) command.push('--pool', formData.pool);
        if (formData.comment) command.push('--comment', formData.comment);
        if (formData.owner) command.push('--owner', formData.owner);
        if (formData.group) command.push('--group', formData.group);
        if (formData.perms) command.push('--perms', formData.perms);
        if (formData.validUsers) command.push('--valid-users', formData.validUsers);
        if (formData.readonly) command.push('--readonly');
        if (formData.noBrowse) command.push('--no-browse');
        if (formData.quota) command.push('--quota', formData.quota);

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
                    isDisabled={loading || !formData.share || !formData.dataset}
                >
                    Save
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
                                name="share" 
                                value={formData.share} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="ZFS Dataset Path" isRequired fieldId="share-dataset">
                            <TextInput 
                                isRequired 
                                type="text" 
                                id="share-dataset" 
                                name="dataset" 
                                placeholder="e.g., data/projects" 
                                value={formData.dataset} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="ZFS Pool" fieldId="share-pool">
                            <select 
                                className="pf-v5-c-form-control" 
                                name="pool" 
                                value={formData.pool} 
                                onChange={(e) => handleChange(e.target.value, e)}
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
                                name="comment" 
                                value={formData.comment} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Owner (user)" fieldId="share-owner">
                            <TextInput 
                                type="text" 
                                id="share-owner" 
                                name="owner" 
                                value={formData.owner} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Owner (group)" fieldId="share-group">
                            <TextInput 
                                type="text" 
                                id="share-group" 
                                name="group" 
                                value={formData.group} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Permissions" fieldId="share-perms">
                            <TextInput 
                                type="text" 
                                id="share-perms" 
                                name="perms" 
                                value={formData.perms} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Valid Users/Groups" fieldId="share-valid-users">
                            <TextInput 
                                type="text" 
                                id="share-valid-users" 
                                name="validUsers" 
                                placeholder="user1,@group1" 
                                value={formData.validUsers} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup label="Quota" fieldId="share-quota">
                            <TextInput 
                                type="text" 
                                id="share-quota" 
                                name="quota" 
                                placeholder="e.g., 100G" 
                                value={formData.quota} 
                                onChange={handleChange} 
                            />
                        </FormGroup>
                    </GridItem>
                    <GridItem span={6}>
                        <FormGroup fieldId="share-options">
                            <Checkbox 
                                label="Make share read-only" 
                                id="share-readonly" 
                                name="readonly" 
                                isChecked={formData.readonly} 
                                onChange={handleChange} 
                            />
                            <Checkbox 
                                label="Hide share from network browse" 
                                id="share-no-browse" 
                                name="noBrowse" 
                                isChecked={formData.noBrowse} 
                                onChange={handleChange} 
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
    // This would be a large form. For brevity, we'll implement a few key fields.
    // A full implementation would mirror the create form.
    const [comment, setComment] = useState(shareData.smb_config.comment || '');
    const [quota, setQuota] = useState(shareData.dataset.quota || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        setLoading(true);
        setError(null);
        const command = ['modify', 'share', share, '--comment', comment, '--quota', quota || 'none'];

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
                <Button key="save" variant="primary" onClick={handleSave} isDisabled={loading}>
                    Save
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
                        name="comment" 
                        value={comment} 
                        onChange={(_event, value) => setComment(value)} 
                    />
                </FormGroup>
                <FormGroup label="Quota" fieldId="mod-share-quota">
                    <TextInput 
                        type="text" 
                        id="mod-share-quota" 
                        name="quota" 
                        value={quota} 
                        onChange={(_event, value) => setQuota(value)} 
                    />
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
                    Delete
                </Button>,
                <Button key="cancel" variant="link" onClick={onClose}>Cancel</Button>
            ]}
        >
            {error && <Alert variant="danger" title="Failed to delete share">{error}</Alert>}
            <p>Are you sure you want to delete share <strong>{share}</strong>?</p>
            <Checkbox 
                label="Permanently delete the share's ZFS dataset." 
                id="delete-data" 
                name="deleteData" 
                isChecked={deleteData} 
                onChange={(_event, checked) => setDeleteData(checked)} 
            />
        </Modal>
    );
};
// #endregion

// #region Password Tab (for non-root)
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
// #endregion