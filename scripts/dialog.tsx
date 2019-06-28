import * as React from "react";
import * as ReactDOM from "react-dom";

import TFS_Wit_Contracts = require("TFS/WorkItemTracking/Contracts");
import TFS_Wit_Client = require("TFS/WorkItemTracking/RestClient");

import { CoreFields } from "./constants";

const DefaultExcludedWorkItemStates = ["Closed", "Removed", "Cut", "Done", "Completed"];
const ExcludedWorkItemMetaStates = ["Completed", "Removed"];

enum LoadingState {
    Loading,
    Loaded
}

function getChildIds(workItem: TFS_Wit_Contracts.WorkItem): number[] {
    return !workItem.relations ? [] : workItem.relations.filter(relation => relation.rel === "System.LinkTypes.Hierarchy-Forward").map(relation => {
        var url = relation.url;
        return parseInt(url.substr(url.lastIndexOf("/") + 1), 10);
    });
}

interface ITextBoxComponentProps extends React.Props<void> {
    value: string;
    onChange: (value: string) => void;
}

class TextBoxComponent extends React.Component<ITextBoxComponentProps, any> {

    public render(): JSX.Element {
        var onChange = (event: any) => {
            this.props.onChange(event.target.value);
        }

        return <fieldset>
            <label htmlFor="name">Title</label>
            <input type="text" id="name" value={this.props.value} onChange={onChange} />
        </fieldset>;
    }
}

interface ICheckboxComponentProps extends React.Props<void> {
    checked: boolean;
    onChange: (value: boolean) => void;
}

class CheckboxComponent extends React.Component<ICheckboxComponentProps, any> {

    public render(): JSX.Element {
        var onChange = (event: any) => {
            this.props.onChange(event.target.checked);
        }

        return <div>
            <input type="checkbox" id="open" checked={this.props.checked} onChange={onChange} /><label htmlFor="open">Open newly created work item</label>
        </div>;
    }
}

class TagCheckboxComponent extends React.Component<ICheckboxComponentProps, any> {

    public render(): JSX.Element {
        var onChange = (event: any) => {
            this.props.onChange(event.target.checked);
        }

        return <div>
            <input type="checkbox" id="tags" checked={this.props.checked} onChange={onChange} /><label htmlFor="tags">Copy tags to new work item</label>
        </div>;
    }
}

interface IListComponentProps extends React.Props<void> {
    items: { key: string | number, title: string }[];
    onRemove: (key: string | number) => void;
}

class ListComponent extends React.Component<IListComponentProps, any> {

    constructor(props: any) {
        super(props);
    }

    public render(): JSX.Element {

        var createItem = (item) => {

            var onRemove = () => {
                this.props.onRemove(item.key);
            };

            return <li key={item.key}>
                <div className="item-color"></div>
                <div className="item-text">{item.title}</div>
                <div className="item-action" onClick={onRemove}></div>
            </li>;
        };

        return <ul className="list">{this.props.items.map(createItem)}</ul>;
    }
}

interface IDialogComponentState {
    loadState: LoadingState;
    workItem: TFS_Wit_Contracts.WorkItem;
    children: TFS_Wit_Contracts.WorkItem[];
    selectedIds: number[];
    newTitle: string;
    openNewWorkItem: boolean;
    copyTags: boolean;
}

class DialogComponent extends React.Component<any, IDialogComponentState> {

    constructor() {
        super();
        this.state = {
            loadState: LoadingState.Loading,
            workItem: null,
            children: [],
            selectedIds: [],
            newTitle: "",
            openNewWorkItem: false,
            copyTags: false
        };
    }

    public render() {
        if (this.state.loadState === LoadingState.Loaded) {
            let { workItem, children, selectedIds, newTitle, openNewWorkItem, copyTags } = this.state;
            if (!children || children.length === 0) {
                return <div>
                    <div>There are no children to be split from this work item.</div>
                    <div className="no-children"></div>
                </div>;
            }
            else {
                let description = ["Below are the incomplete items for ", <strong key={workItem.id}>{workItem.fields[CoreFields.WorkItemType]}: {workItem.id}</strong>, ".  Split to continue them in your next sprint."];
                let items = children.filter(workitem => selectedIds.indexOf(workitem.id) !== -1).map(child => {
                    return {
                        key: child.id,
                        title: `${child.id}: ${child.fields[CoreFields.Title]}`
                    }
                });

                var onTextboxChange = (value) => {
                    this.setState(Object["assign"]({}, this.state, { newTitle: value }));
                };

                var onCheckboxChange = (value) => {
                    this.setState(Object["assign"]({}, this.state, { openNewWorkItem: value }));
                };

                var onCopyTagsChange = (value) => {
                    this.setState(Object["assign"]({}, this.state, { copyTags: value }));
                };

                var onRemove = (key: string | number) => {
                    this.setState(Object["assign"]({}, this.state, { selectedIds: selectedIds.filter(i => i !== key) }));
                };

                return <div>
                    <div>{description}</div>
                    <TextBoxComponent value={newTitle} onChange={onTextboxChange} />
                    <ListComponent items={items} onRemove={onRemove} />
                    <CheckboxComponent checked={openNewWorkItem} onChange={onCheckboxChange} /> <br />
                    <TagCheckboxComponent checked={copyTags} onChange={onCopyTagsChange} />
                </div>;
            }
        }
        return null;
    }


    public async startSplit(id: number): Promise<boolean> {
        var client = TFS_Wit_Client.getClient();
        const context = VSS.getWebContext();

        const workItem = await client.getWorkItem(id, null, null, TFS_Wit_Contracts.WorkItemExpand.All)
        var childIds = getChildIds(workItem);

        // Display "No children to be split"
        if (childIds.length === 0) {
            this.setState({
                loadState: LoadingState.Loaded,
                workItem: null,
                children: [],
                selectedIds: [],
                newTitle: "",
                openNewWorkItem: false,
                copyTags: false
            });
            return false;
        }
        else {                     
            var workItemTypeToExcludedStates = {};
            var incompleteChildren = [];

            const children = await client.getWorkItems(childIds)   

            for (var i = 0, len = children.length; i < len; i++) {
                const childItem = children[i];
                const childItemType = childItem.fields[CoreFields.WorkItemType];
                
                // We need to determine this child's specific "Completed" and "Removed" states (may be custom depending on process)
                // For example, "Closed" state is from the "Completed" category. Some users may have a custom process with additional 
                // states in "Completed" or "Removed". After fetching, store each type's states in a dictionary 
                if (!workItemTypeToExcludedStates[childItemType]) {
                    const states = await client.getWorkItemTypeStates(context.project.name, childItem.fields[CoreFields.WorkItemType]);
                    const stateNamesInExcludedCategory = []; 
                    states.forEach(s => {
                        if (s.category === ExcludedWorkItemMetaStates[0] || s.category === ExcludedWorkItemMetaStates[1]){
                            stateNamesInExcludedCategory.push(s.name); 
                        }
                    })
                    
                    workItemTypeToExcludedStates[childItemType] = stateNamesInExcludedCategory; 
                }

                // Check if this child work item is in an incomplete state ("Proposed", "In Progress", or "Resolved")
                const excludedStates = workItemTypeToExcludedStates[childItemType] || DefaultExcludedWorkItemStates;
                const childState = children[i].fields[CoreFields.State];
                if (excludedStates.indexOf(childState) === -1) {
                    incompleteChildren.push(children[i]);
                }
            }

            this.setState({
                workItem: workItem,
                children: incompleteChildren,
                loadState: LoadingState.Loaded,
                selectedIds: incompleteChildren.map(c => c.id),
                newTitle: workItem.fields[CoreFields.Title],
                openNewWorkItem: true,
                copyTags: true
            });

            return this.state.selectedIds.length > 0;             
        }
    }
}

let element = document.getElementById("main");
let dialogComponent: DialogComponent;
ReactDOM.render(<DialogComponent ref={(i) => dialogComponent = i} />, element);

var dialog = {
    startSplit: (id: number) => dialogComponent.startSplit(id),
    getDetails: (): { ids: number[], title: string, shouldOpenNewWorkItem: boolean, shouldCopyTags: boolean } => {
        return {
            ids: dialogComponent.state.selectedIds,
            title: dialogComponent.state.newTitle,
            shouldOpenNewWorkItem: dialogComponent.state.openNewWorkItem,
            shouldCopyTags: dialogComponent.state.copyTags
        };
    }
};

VSS.register(VSS.getContribution().id, dialog);
VSS.notifyLoadSucceeded();