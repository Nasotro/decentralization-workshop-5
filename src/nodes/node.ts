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
    decided: false,
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
    const { senderId, value } = req.body;
    if (senderId !== nodeId && !isFaulty) {
      // Update the node's state based on the received message
      receivedValues[senderId] = value;

      const n_received = receivedValues.filter((v) => v !== null).length;
      
      console.log(`Node ${nodeId} received message from node ${senderId} with value ${value} | recieved values: ${receivedValues}, check consensus ? ${n_received >= N - F - 1} (N: ${N}, F: ${F})`);



      // Check if consensus is reached
      if (!nodeState.decided && nodeState.x !== null) {
        let consensusCount = 0;
        for (let i = 0; i < N; i++) {
          if (receivedValues[i] === nodeState.x) {
            consensusCount++;
          }
        }
        if (consensusCount >= (N - F)/2) {
          nodeState.decided = true;
          console.log(`Consensus reached by node ${nodeId} with value ${nodeState.x}`);
        }
        else{
          console.log(`Consensus not reached by node ${nodeId} with value ${nodeState.x}`);
          if (nodeState.k === 0) {
            nodeState.k = 1; // Start the first round
          }
          if (nodeState.x === null) {
            nodeState.x = value; // Initialize x if it's null
          }
          nodeState.x = Math.random() < 0.5 ? nodeState.x : value; // Randomly decide the value
        }
      }
    }
    res.status(200).send("Message received");
  });

  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    if (!isFaulty) {
      // Send the initial value to all other nodes
      for (let i = 0; i < N; i++) {
        if (i !== nodeId) {
          await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ senderId: nodeId, value: initialValue }),
          });
        }
      }
      // Begin the decision-making process
      nodeState.k = 1; // Advance to the next round
      console.log(`Consensus started by node ${nodeId}`);
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
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}