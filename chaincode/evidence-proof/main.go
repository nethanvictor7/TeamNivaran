package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-protos-go/peer"
)

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type ProofChaincode struct{}

type EvidenceProof struct {
	Kind                  string  `json:"kind"`
	SchemaVersion         string  `json:"schemaVersion"`
	ProofID               string  `json:"proofId"`
	OrganizationScopeHash string  `json:"organizationScopeHash"`
	CaseReferenceHash     string  `json:"caseReferenceHash"`
	EvidenceID            string  `json:"evidenceId"`
	EvidenceVersionID     string  `json:"evidenceVersionId"`
	ContentSHA256         string  `json:"contentSha256"`
	MetadataSHA256        string  `json:"metadataSha256"`
	PreviousProofID       *string `json:"previousProofId"`
}

type DecisionProof struct {
	Kind                   string `json:"kind"`
	SchemaVersion          string `json:"schemaVersion"`
	ProofID                string `json:"proofId"`
	CaseReferenceHash      string `json:"caseReferenceHash"`
	WorkflowInstanceID     string `json:"workflowInstanceId"`
	DecisionID             string `json:"decisionId"`
	DecisionOutcomeCode    string `json:"decisionOutcomeCode"`
	EvidenceManifestSHA256 string `json:"evidenceManifestSha256"`
	RecommendationSHA256   string `json:"recommendationSha256"`
	DecisionRecordSHA256   string `json:"decisionRecordSha256"`
}

type ProofRecord struct {
	ProofID       string          `json:"proofId"`
	Kind          string          `json:"kind"`
	SchemaVersion string          `json:"schemaVersion"`
	AnchoredAt    string          `json:"anchoredAt"`
	TransactionID string          `json:"transactionId"`
	Payload       json.RawMessage `json:"payload"`
}

func (c *ProofChaincode) Init(shim.ChaincodeStubInterface) peer.Response {
	return shim.Success(nil)
}

func (c *ProofChaincode) Invoke(stub shim.ChaincodeStubInterface) peer.Response {
	function, args := stub.GetFunctionAndParameters()
	switch function {
	case "AnchorEvidenceProof":
		return c.anchorEvidence(stub, args)
	case "GetEvidenceProof":
		return c.getTypedProof(stub, args, "EVIDENCE")
	case "VerifyEvidenceHash":
		return c.verifyEvidence(stub, args)
	case "GetEvidenceVersionHistory":
		return c.history(stub, args)
	case "AnchorDecisionPackageProof":
		return c.anchorDecision(stub, args)
	case "GetDecisionPackageProof":
		return c.getTypedProof(stub, args, "DECISION")
	case "VerifyDecisionPackage":
		return c.verifyDecision(stub, args)
	case "GetProof":
		return c.getTypedProof(stub, args, "")
	case "GetNetworkStatus":
		return shim.Success([]byte(`{"status":"AVAILABLE","schemaVersion":"1.0"}`))
	default:
		return shim.Error("UNKNOWN_FUNCTION")
	}
}

func strictDecode(input string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(input))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.More() {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}

func validateEvidence(value EvidenceProof) error {
	if value.Kind != "EVIDENCE" || value.SchemaVersion != "1.0" {
		return fmt.Errorf("INVALID_SCHEMA")
	}
	if !uuidPattern.MatchString(value.ProofID) ||
		!uuidPattern.MatchString(value.EvidenceID) ||
		!uuidPattern.MatchString(value.EvidenceVersionID) {
		return fmt.Errorf("INVALID_IDENTIFIER")
	}
	if value.PreviousProofID != nil && !uuidPattern.MatchString(*value.PreviousProofID) {
		return fmt.Errorf("INVALID_PREVIOUS_PROOF")
	}
	for _, value := range []string{
		value.OrganizationScopeHash,
		value.CaseReferenceHash,
		value.ContentSHA256,
		value.MetadataSHA256,
	} {
		if !hashPattern.MatchString(value) {
			return fmt.Errorf("INVALID_HASH")
		}
	}
	return nil
}

func validateDecision(value DecisionProof) error {
	if value.Kind != "DECISION" || value.SchemaVersion != "1.0" {
		return fmt.Errorf("INVALID_SCHEMA")
	}
	if !uuidPattern.MatchString(value.ProofID) ||
		!uuidPattern.MatchString(value.WorkflowInstanceID) ||
		!uuidPattern.MatchString(value.DecisionID) {
		return fmt.Errorf("INVALID_IDENTIFIER")
	}
	if value.DecisionOutcomeCode != "APPROVED" && value.DecisionOutcomeCode != "REJECTED" {
		return fmt.Errorf("INVALID_OUTCOME")
	}
	for _, value := range []string{
		value.CaseReferenceHash,
		value.EvidenceManifestSHA256,
		value.RecommendationSHA256,
		value.DecisionRecordSHA256,
	} {
		if !hashPattern.MatchString(value) {
			return fmt.Errorf("INVALID_HASH")
		}
	}
	return nil
}

func (c *ProofChaincode) anchorEvidence(stub shim.ChaincodeStubInterface, args []string) peer.Response {
	if len(args) != 1 {
		return shim.Error("INVALID_ARGUMENT_COUNT")
	}
	var proof EvidenceProof
	if err := strictDecode(args[0], &proof); err != nil {
		return shim.Error("INVALID_EVIDENCE_PROOF")
	}
	if err := validateEvidence(proof); err != nil {
		return shim.Error(err.Error())
	}
	canonical, err := canonicalJSON(proof)
	if err != nil {
		return shim.Error("CANONICALIZATION_FAILED")
	}
	return c.anchor(stub, proof.ProofID, proof.Kind, canonical)
}

func (c *ProofChaincode) anchorDecision(stub shim.ChaincodeStubInterface, args []string) peer.Response {
	if len(args) != 1 {
		return shim.Error("INVALID_ARGUMENT_COUNT")
	}
	var proof DecisionProof
	if err := strictDecode(args[0], &proof); err != nil {
		return shim.Error("INVALID_DECISION_PROOF")
	}
	if err := validateDecision(proof); err != nil {
		return shim.Error(err.Error())
	}
	canonical, err := canonicalJSON(proof)
	if err != nil {
		return shim.Error("CANONICALIZATION_FAILED")
	}
	return c.anchor(stub, proof.ProofID, proof.Kind, canonical)
}

func (c *ProofChaincode) anchor(stub shim.ChaincodeStubInterface, proofID, kind string, payload []byte) peer.Response {
	key := "proof:" + proofID
	existingBytes, err := stub.GetState(key)
	if err != nil {
		return shim.Error("STATE_READ_FAILED")
	}
	if existingBytes != nil {
		var existing ProofRecord
		if json.Unmarshal(existingBytes, &existing) != nil {
			return shim.Error("STATE_CORRUPT")
		}
		if bytes.Equal(existing.Payload, payload) {
			return shim.Success(existingBytes)
		}
		return shim.Error("PROOF_ID_CONFLICT")
	}
	timestamp, err := stub.GetTxTimestamp()
	if err != nil {
		return shim.Error("TRANSACTION_TIMESTAMP_UNAVAILABLE")
	}
	record := ProofRecord{
		ProofID:       proofID,
		Kind:          kind,
		SchemaVersion: "1.0",
		AnchoredAt:    timestamp.AsTime().UTC().Format(time.RFC3339Nano),
		TransactionID: stub.GetTxID(),
		Payload:       payload,
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return shim.Error("ENCODING_FAILED")
	}
	if err := stub.PutState(key, encoded); err != nil {
		return shim.Error("STATE_WRITE_FAILED")
	}
	return shim.Success(encoded)
}

func (c *ProofChaincode) getTypedProof(stub shim.ChaincodeStubInterface, args []string, kind string) peer.Response {
	if len(args) != 1 || !uuidPattern.MatchString(args[0]) {
		return shim.Error("INVALID_PROOF_ID")
	}
	value, err := stub.GetState("proof:" + args[0])
	if err != nil {
		return shim.Error("STATE_READ_FAILED")
	}
	if value == nil {
		return shim.Error("PROOF_NOT_FOUND")
	}
	if kind != "" {
		var record ProofRecord
		if json.Unmarshal(value, &record) != nil || record.Kind != kind {
			return shim.Error("PROOF_NOT_FOUND")
		}
	}
	return shim.Success(value)
}

func (c *ProofChaincode) verifyEvidence(stub shim.ChaincodeStubInterface, args []string) peer.Response {
	if len(args) != 2 || !hashPattern.MatchString(args[1]) {
		return shim.Error("INVALID_VERIFY_REQUEST")
	}
	response := c.getTypedProof(stub, args[:1], "EVIDENCE")
	if response.Status != shim.OK {
		return response
	}
	var record ProofRecord
	var proof EvidenceProof
	if json.Unmarshal(response.Payload, &record) != nil || json.Unmarshal(record.Payload, &proof) != nil {
		return shim.Error("STATE_CORRUPT")
	}
	return verificationResponse(record, proof.ContentSHA256 == args[1])
}

func (c *ProofChaincode) verifyDecision(stub shim.ChaincodeStubInterface, args []string) peer.Response {
	if len(args) != 4 {
		return shim.Error("INVALID_VERIFY_REQUEST")
	}
	for _, value := range args[1:] {
		if !hashPattern.MatchString(value) {
			return shim.Error("INVALID_HASH")
		}
	}
	response := c.getTypedProof(stub, args[:1], "DECISION")
	if response.Status != shim.OK {
		return response
	}
	var record ProofRecord
	var proof DecisionProof
	if json.Unmarshal(response.Payload, &record) != nil || json.Unmarshal(record.Payload, &proof) != nil {
		return shim.Error("STATE_CORRUPT")
	}
	match := proof.EvidenceManifestSHA256 == args[1] &&
		proof.RecommendationSHA256 == args[2] &&
		proof.DecisionRecordSHA256 == args[3]
	return verificationResponse(record, match)
}

func verificationResponse(record ProofRecord, match bool) peer.Response {
	value, _ := json.Marshal(map[string]any{
		"proofId":       record.ProofID,
		"confirmed":     true,
		"hashMatch":     match,
		"anchoredAt":    record.AnchoredAt,
		"transactionId": record.TransactionID,
	})
	return shim.Success(value)
}

func (c *ProofChaincode) history(stub shim.ChaincodeStubInterface, args []string) peer.Response {
	if len(args) != 1 || !uuidPattern.MatchString(args[0]) {
		return shim.Error("INVALID_PROOF_ID")
	}
	iterator, err := stub.GetHistoryForKey("proof:" + args[0])
	if err != nil {
		return shim.Error("HISTORY_UNAVAILABLE")
	}
	defer iterator.Close()
	var entries []json.RawMessage
	for iterator.HasNext() {
		entry, err := iterator.Next()
		if err != nil {
			return shim.Error("HISTORY_READ_FAILED")
		}
		if !entry.IsDelete {
			entries = append(entries, entry.Value)
		}
	}
	encoded, _ := json.Marshal(entries)
	return shim.Success(encoded)
}

func canonicalJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	if err := writeCanonical(&buffer, decoded); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writeCanonical(buffer *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case nil, bool, float64, string:
		raw, err := json.Marshal(typed)
		if err == nil {
			buffer.Write(raw)
		}
		return err
	case []any:
		buffer.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				buffer.WriteByte(',')
			}
			if err := writeCanonical(buffer, item); err != nil {
				return err
			}
		}
		buffer.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		buffer.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				buffer.WriteByte(',')
			}
			raw, _ := json.Marshal(key)
			buffer.Write(raw)
			buffer.WriteByte(':')
			if err := writeCanonical(buffer, typed[key]); err != nil {
				return err
			}
		}
		buffer.WriteByte('}')
	default:
		return fmt.Errorf("unsupported canonical value")
	}
	return nil
}

func canonicalSHA256(value any) (string, error) {
	bytes, err := canonicalJSON(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:]), nil
}

func main() {
	serverAddress := os.Getenv("CHAINCODE_SERVER_ADDRESS")
	chaincodeID := os.Getenv("CHAINCODE_ID")
	if serverAddress != "" || chaincodeID != "" {
		if serverAddress == "" || chaincodeID == "" {
			panic("CHAINCODE_SERVER_ADDRESS and CHAINCODE_ID must both be set")
		}
		server := &shim.ChaincodeServer{
			CCID:    chaincodeID,
			Address: serverAddress,
			CC:      &ProofChaincode{},
			TLSProps: shim.TLSProperties{
				Disabled: true,
			},
		}
		if err := server.Start(); err != nil {
			panic(err)
		}
		return
	}
	if err := shim.Start(&ProofChaincode{}); err != nil {
		panic(err)
	}
}
