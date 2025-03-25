import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let nodeState: NodeState = {
    killed: false,
    x: initialValue,
    decided: isFaulty ? null : false,
    k: 0,
  };

  if (isFaulty) {
    nodeState = {
      killed: false,
      x: null,
      decided: null,
      k: null,
    };
  }

  let phase1Messages = Array(N).fill(null);
  let phase2Messages = Array(N).fill(null);

  let receivedValues: (Value | null)[] = Array(N).fill(null);
  receivedValues[nodeId] = initialValue;

  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).json(nodeState);
  });

  // this route allows the node to receive messages from other nodes
  node.post("/message", (req, res) => {
    if (nodeState.killed) {
      res.status(500).send("Node is killed");
      return;
    }
    if (!nodeState.decided) {
      const { senderId, value } = req.body;
      const phase = value.phase;
      const k = value.k;
      const x = value.x;

      // if the node is faulty, it doesn't respond to messages
      if (isFaulty) {
        res.status(200).send("Message received by faulty node");
        return;
      }

      if (nodeState.k === value.k) {
        if (phase === 1) {
          phase1Messages[senderId] = x;
        }
        if (phase === 2) {
          phase2Messages[senderId] = x;
        }
      }
    }

    res.status(200).send("Message received");
  });

  async function sendMessageToAll(phase: number, k: number, x: Value) {
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ senderId: nodeId, value: { phase, k, x } }),
        });
      }
    }
  }

  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    if (isFaulty || nodeState.killed || nodeState.k == null || nodeState.x == null) {
      res.status(500).send("Node is faulty or killed");
      return;
    }
    while (!nodeState.decided && !nodeState.killed && nodeState.k! <= 12) {
      nodeState.k++;

      // PHASE 1:
      await sendMessageToAll(1, nodeState.k, nodeState.x);
      console.log(`Node ${nodeId} sent phase 1 messages`);
      //get the majority value of the phase 1 messages
      let majorityValue1: Value = 0;
      let majorityValues1 = [0, 0];

      for (let i = 0; i < N; i++) {
        if (phase1Messages[i] !== null) {
          majorityValues1[phase1Messages[i]]++;
        }
      }
      if (majorityValues1[0] > (N - F) / 2) {
        // if (majorityValues1[0] > N / 2) {
        majorityValue1 = 0;
      }
      // else if (majorityValues1[1] > N / 2) {
      else if (majorityValues1[1] > (N - F) / 2) {
        majorityValue1 = 1;
      }
      else {
        majorityValue1 = 1;
      }
      console.log(`Node ${nodeId} decided on value ${majorityValue1} for the phase 1`);


      // PHASE 2:
      await sendMessageToAll(2, nodeState.k, majorityValue1);
      console.log(`Node ${nodeId} sent phase 2 messages`);

      //get the majority value of the phase 2 messages
      let majorityValue2: Value = 0;
      let majorityValues2 = [0, 0];

      for (let i = 0; i < N; i++) {
        if (phase2Messages[i] !== null) {
          majorityValues2[phase2Messages[i]]++;
        }
      }

      // console.log(`Node ${nodeId} F is ${F}, N is ${N}, F*2 is ${F * 2}`);

      if ((F * 2) >= N) { // if we exceed the fault limit
        console.log(`Node ${nodeId} exceeded the fault limit`);
        nodeState.x = Math.floor(Math.random() * 2) as Value;
        // nodeState.decided = false;
      }
      else {
        // if (majorityValues2[0] >= F + 1) {
        if (majorityValues2[0] > (N - F) / 2) {
          majorityValue2 = 0;
        }
        else if (majorityValues2[1] > (N - F) / 2) {
          majorityValue2 = 1;
        }
        else {
          majorityValue2 = majorityValue1;
        }
        nodeState.x = majorityValue2;
        nodeState.decided = true;
        // nodeState.k++;
      }
      console.log(`Node ${nodeId} decided on value ${majorityValue2} for the phase 2`);
      // console.log(`state of node ${nodeId} is ${JSON.stringify(nodeState)}`);
      
    }
    res.status(200).send("Consensus started");
  });

  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    console.log(`Consensus stopped by node ${nodeId}`);
    res.status(200).send("Consensus stopped");
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    // console.log(
    //   `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    // );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
